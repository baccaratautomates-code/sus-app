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
export function extractUrl(text: string): string | null {
  if (!text) return null;

  const httpMatch = text.match(/https?:\/\/[^\s,]+/i);
  if (httpMatch) return cleanTrailingPunctuation(httpMatch[0]);

  const wwwMatch = text.match(/www\.[a-z0-9.-]+(?:\.[a-z]{2,})+(?:\/[^\s,]*)?/i);
  if (wwwMatch) return `https://${cleanTrailingPunctuation(wwwMatch[0])}`;

  // Marketplace domains — the URL bar often shows just the host (no scheme,
  // no www) once the user has tapped an autocomplete suggestion. Each branch
  // captures the OPTIONAL trailing path so we keep /product/<shop>/<item>
  // identifiers when present — without those, the marketplace-specific
  // scrapers can only evaluate the domain and the verdict degrades to
  // Not Enough Info. Listed in rough order of demo relevance (PH-first).
  const marketplaceMatch = text.match(
    /\b((?:shopee\.(?:com\.)?ph|lazada\.com\.ph)(?:\/[^\s,]*)?|tiktok\.com\/@?[\w.-]+(?:\/[^\s,]*)?|facebook\.com\/marketplace\/item\/\d+|amazon\.com(?:\.[a-z]{2})?\/[^\s,]+)/i,
  );
  if (marketplaceMatch) return `https://${cleanTrailingPunctuation(marketplaceMatch[0])}`;

  return null;
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
      return "Sus doesn't yet evaluate individual Facebook Marketplace sellers — third-party watchdogs like Trustpilot, Scamadviser, and DTI don't index P2P listings. Check the seller's profile age and message history directly, and prefer meet-up with cash-on-delivery. Sus works best on Shopee, Lazada, TikTok Shop, and brand websites.";
    case "ig-shop":
      return "Sus doesn't yet evaluate Instagram shop posts. Try a brand website or marketplace listing URL instead, or check seller reviews on the platform directly.";
  }
}
