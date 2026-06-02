import { env } from "./env";

interface OcrSpaceResponse {
  ParsedResults?: Array<{ ParsedText?: string }>;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string[] | string;
}

// Calls OCR.space — a free OCR API with 25K req/month on the developer tier.
// We use OCREngine 2 because it handles screenshots with mixed UI chrome +
// product text much better than engine 1.
export async function ocrImage(base64Jpeg: string): Promise<string> {
  const form = new FormData();
  form.append("base64Image", `data:image/jpeg;base64,${base64Jpeg}`);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("scale", "true");
  form.append("OCREngine", "2");

  const res = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: { apikey: env.OCR_SPACE_API_KEY },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`OCR.space returned ${res.status}`);
  }

  const data = (await res.json()) as OcrSpaceResponse;
  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage)
      ? data.ErrorMessage.join("; ")
      : (data.ErrorMessage ?? "unknown OCR error");
    throw new Error(`OCR error: ${msg}`);
  }

  return data.ParsedResults?.[0]?.ParsedText?.trim() ?? "";
}

// Pulls a plausible product/seller URL from OCR text. Order of preference:
//   1. Explicit http(s)://… link (most reliable)
//   2. www.<domain>/path (URL bar after autocomplete dropped the scheme)
//   3. Bare marketplace domain anywhere in the text (e.g. "shopee.ph/abc")
// Returns null if nothing usable is found — caller responds with Not Enough Info.
//
// Defense against OCR overshoot: zero-width characters (U+200B ZWSP, U+200C
// ZWNJ, U+200D ZWJ, U+FEFF BOM) are NOT matched by \s in JS regexes, so a
// naïve [^\s,]+ would happily eat past them and capture URL + the share-text
// that comes after. We saw this in the wild — TikTok Lite share screenshots
// produced History rows with target = "https://vm.tiktok.com/... This post
// is shared via TikTok Lite..." because the URL was glued to the message
// through a zero-width separator. Strip those characters up front, tighten
// the character class to exclude common natural-language terminators, and
// validate every candidate with `new URL()` before returning it.
export function extractUrl(text: string): string | null {
  if (!text) return null;

  // Replace zero-width characters with spaces so they act as URL boundaries
  // for the regexes below. Operating on a normalized copy keeps the original
  // OCR text untouched for downstream diagnostics.
  const cleaned = text.replace(/[​-‍﻿]/g, " ");

  // Exclude characters that almost never appear inside product URLs but DO
  // appear right after them in natural-language text: quotes, brackets,
  // braces, angle brackets, pipes. (Whitespace and commas are also excluded.)
  const URL_BODY = /[^\s,"'<>(){}\[\]|]+/.source;

  const httpMatch = cleaned.match(new RegExp(`https?:\\/\\/${URL_BODY}`, "i"));
  if (httpMatch) {
    const candidate = cleanTrailingPunctuation(httpMatch[0]);
    if (isPlausibleProductUrl(candidate)) return candidate;
  }

  const wwwMatch = cleaned.match(
    new RegExp(`www\\.[a-z0-9.-]+(?:\\.[a-z]{2,})+(?:\\/${URL_BODY})?`, "i"),
  );
  if (wwwMatch) {
    const candidate = `https://${cleanTrailingPunctuation(wwwMatch[0])}`;
    if (isPlausibleProductUrl(candidate)) return candidate;
  }

  // Marketplace domains — the URL bar often shows just the host (no scheme,
  // no www) once the user has tapped an autocomplete suggestion. Each branch
  // captures the OPTIONAL trailing path so we keep /product/<shop>/<item>
  // identifiers when present — without those, the marketplace-specific
  // scrapers can only evaluate the domain and the verdict degrades to
  // Not Enough Info. Listed in rough order of demo relevance (PH-first).
  const marketplaceMatch = cleaned.match(
    new RegExp(
      `\\b((?:shopee\\.(?:com\\.)?ph|lazada\\.com\\.ph)(?:\\/${URL_BODY})?|tiktok\\.com\\/@?[\\w.-]+(?:\\/${URL_BODY})?|facebook\\.com\\/marketplace\\/item\\/\\d+|amazon\\.com(?:\\.[a-z]{2})?\\/${URL_BODY})`,
      "i",
    ),
  );
  if (marketplaceMatch) {
    const candidate = `https://${cleanTrailingPunctuation(marketplaceMatch[0])}`;
    if (isPlausibleProductUrl(candidate)) return candidate;
  }

  return null;
}

// Guards against extracted strings that look URL-shaped but aren't actually
// parseable, AND against runaway matches that overshoot into surrounding
// text. Real product URLs are well under 500 chars; longer strings are
// almost certainly OCR overshoot we should reject rather than scan.
const MAX_URL_LENGTH = 500;

function isPlausibleProductUrl(candidate: string): boolean {
  if (candidate.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(candidate);
    return Boolean(url.host);
  } catch {
    return false;
  }
}

// OCR commonly attaches trailing dots, commas, brackets, and zero-width chars
// to the end of URLs. Strip the common ones so the scan target is clean.
function cleanTrailingPunctuation(url: string): string {
  return url.replace(/[.,;)\]>​-‍﻿]+$/, "");
}

// URL patterns we recognize but can't usefully evaluate in v1 — none of our
// third-party signal sources (Trustpilot, Scamadviser, DTI, Reddit r/scams)
// index individual P2P listings on these platforms. Returning Not Enough Info
// with tailored copy is more honest than running the scrape pipeline and
// returning a generic "we couldn't find evidence" message after 25 seconds.
export type UnsupportedReason = "fb-marketplace" | "ig-shop" | "tiktok-shop-product";

export function detectUnsupportedMarketplace(url: string): UnsupportedReason | null {
  if (/facebook\.com\/marketplace\/item\//i.test(url)) return "fb-marketplace";
  if (/instagram\.com\/(?:p|reel)\//i.test(url)) return "ig-shop";
  // TikTok Shop PRODUCT listings: the product/seller data is walled behind
  // TikTok's app + login + signed APIs. The public page is an empty client
  // shell — verified that even a full JS-rendered fetch carries no product,
  // price, rating, or seller data. So there's nothing to scrape, by anyone,
  // without a logged-in session. Matches the region-prefixed web PDP form
  // (tiktok.com/ph/pdp/<slug>/<id>) and the shop-subdomain form
  // (shop-xx.tiktok.com/view/product/<id>). Creator/seller PROFILE URLs
  // (tiktok.com/@handle) are still fully scannable and must NOT match here.
  if (/tiktok\.com\/(?:[a-z]{2}\/)?(?:pdp|view\/product|product)\//i.test(url)) {
    return "tiktok-shop-product";
  }
  return null;
}

export function unsupportedMarketplaceMessage(reason: UnsupportedReason): string {
  switch (reason) {
    case "fb-marketplace":
      return "Facebook Marketplace listings can't be checked — third-party watchdogs (Trustpilot, Scamadviser, DTI) don't index P2P trades, and FB itself walls profile data behind login. Best you can do: check the seller's profile age, message them first, and meet up with cash-on-delivery when possible. Sus works best on Shopee, Lazada, TikTok Shop, and brand websites.";
    case "ig-shop":
      return "Instagram shop posts can't be checked — there's no public review data Sus can pull. Try a brand website or marketplace listing URL instead, or scroll the seller's tagged posts and DM history before paying.";
    case "tiktok-shop-product":
      return "TikTok Shop product listings can't be independently checked — TikTok keeps the product and seller data behind its app and login, so there's no public record for Sus to pull. Best move: tap the seller's name to open their TikTok profile and paste THAT link into Sus instead — a verified badge and a real follower count are good signs. Also look for TikTok's orange Shop / Shop Guarantee badge and read the in-app reviews before paying.";
  }
}

// When OCR finds no URL, the screenshot itself often still tells us which
// marketplace the user was looking at — the UI chrome leaks the brand. We
// detect that here so the "no URL found" copy can give marketplace-specific
// recovery instructions instead of the generic "crop the address bar" hint
// (which is actively wrong for TikTok Shop — it's in-app only, no URL bar).
//
// Detection is intentionally loose: OCR is noisy, "Add to basket" can come
// through as "Add to bsket", so we look for a SET of weak signals and require
// 2+ matches before classifying. False positives are worse than misses — a
// wrong marketplace hint in the error copy is more confusing than no hint.
export type ScreenshotMarketplace = "tiktok-shop" | "shopee" | "lazada";

const TIKTOK_SHOP_MARKERS = [
  /add to basket/i,
  /buy now/i,
  /\bmall\b/i,
  /shop guarantee/i,
  /free \d+-?day return/i,
  /\bsold\b.*\d/i,
];

const SHOPEE_MARKERS = [
  /add to cart/i,
  /shopee/i,
  /shopee mall/i,
  /shopee guarantee/i,
  /preferred seller/i,
  /cash on delivery/i,
];

const LAZADA_MARKERS = [
  /lazada/i,
  /lazmall/i,
  /add to cart/i,
  /buy now/i,
  /official store/i,
];

export function detectScreenshotMarketplace(text: string): ScreenshotMarketplace | null {
  if (!text) return null;
  const counts: Record<ScreenshotMarketplace, number> = {
    "tiktok-shop": TIKTOK_SHOP_MARKERS.filter((re) => re.test(text)).length,
    shopee: SHOPEE_MARKERS.filter((re) => re.test(text)).length,
    lazada: LAZADA_MARKERS.filter((re) => re.test(text)).length,
  };

  // Lazada wins outright if the brand name itself is in the OCR — its UI
  // chrome overlaps heavily with Shopee, so the brand-name match disambiguates.
  if (/lazada|lazmall/i.test(text)) return "lazada";
  // Same logic for Shopee — explicit brand name beats generic markers.
  if (/shopee/i.test(text)) return "shopee";

  // TikTok Shop has no brand text in most product pages, so fall back to
  // marker count. Threshold of 2 keeps us from misfiring on Shopee/Lazada
  // screenshots that happen to contain a single shared phrase ("Buy now").
  if (counts["tiktok-shop"] >= 2) return "tiktok-shop";

  return null;
}

export function screenshotMarketplaceMessage(marketplace: ScreenshotMarketplace): string {
  switch (marketplace) {
    case "tiktok-shop":
      return "Looks like a TikTok Shop screenshot. TikTok Shop is in-app only — there's no URL bar to crop. Tap the ⋯ menu on the listing → Copy link → paste it into Sus to scan.";
    case "shopee":
      return "Looks like a Shopee screenshot. Tap the share icon on the listing → Copy link, or open the listing in a browser and re-screenshot with the address bar visible.";
    case "lazada":
      return "Looks like a Lazada screenshot. Tap the share icon on the listing → Copy link, or open the listing in a browser and re-screenshot with the address bar visible.";
  }
}
