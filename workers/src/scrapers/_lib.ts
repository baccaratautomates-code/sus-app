// Shared helpers used by multiple scrapers. The leading underscore in the filename
// keeps it out of the alphabetical scraper listing in folder views.
import { getDomain } from "tldts";
import type { ScrapeResult } from "@sus/shared";

// Returns the registrable domain (eTLD+1), e.g.:
//   "https://ph.shein.com/foo"   -> "shein.com"
//   "https://m.amazon.com/dp/X"  -> "amazon.com"
//   "https://shopee.com.ph/seller" -> "shopee.com.ph"  (handles multi-level TLDs)
//   "https://bbc.co.uk"          -> "bbc.co.uk"
// Returns null when the input has no parseable host or no valid public suffix.
export function extractDomain(input: string): string | null {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return getDomain(withScheme, { validHosts: ["localhost"] });
}

export function emptyResult(source: string, jobId: string): ScrapeResult {
  return {
    source,
    job_id: jobId,
    signals: [],
    scraped_at: new Date().toISOString(),
  };
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
