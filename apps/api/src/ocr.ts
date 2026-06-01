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
export type UnsupportedReason = "fb-marketplace" | "ig-shop";

export function detectUnsupportedMarketplace(url: string): UnsupportedReason | null {
  if (/facebook\.com\/marketplace\/item\//i.test(url)) return "fb-marketplace";
  if (/instagram\.com\/(?:p|reel)\//i.test(url)) return "ig-shop";
  return null;
}

export function unsupportedMarketplaceMessage(reason: UnsupportedReason): string {
  switch (reason) {
    case "fb-marketplace":
      return "Facebook Marketplace listings can't be checked — third-party watchdogs (Trustpilot, Scamadviser, DTI) don't index P2P trades, and FB itself walls profile data behind login. Best you can do: check the seller's profile age, message them first, and meet up with cash-on-delivery when possible. Sus works best on Shopee, Lazada, TikTok Shop, and brand websites.";
    case "ig-shop":
      return "Instagram shop posts can't be checked — there's no public review data Sus can pull. Try a brand website or marketplace listing URL instead, or scroll the seller's tagged posts and DM history before paying.";
  }
}
