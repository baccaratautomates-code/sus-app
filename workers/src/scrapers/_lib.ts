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

// Consumer marketplaces (Lazada, Shopee, TikTok, …) block datacenter IPs with
// HTTP 403 / anti-bot captcha pages — so a plain server-side fetch from a host
// like Railway gets nothing. When SCRAPER_API_KEY is set we route the request
// through ScraperAPI, which fetches it through a residential IP and returns the
// real response body. Without the key we fall back to a direct fetch (works in
// local dev on a residential connection; degrades gracefully in prod).
//
// `countryCode` geo-targets the proxy exit node (e.g. "ph" for Lazada PH, which
// also reduces the chance of a region challenge). Pass the SAME timeoutMs you'd
// use for a direct fetch — proxying adds latency, so size it generously.
// `ultraPremium` routes through ScraperAPI's Ultra Premium pool — required for
// the most aggressively-protected domains (e.g. shopee.ph, which 403s the basic
// pool). It costs more credits and is only available on PAID ScraperAPI plans;
// on the free plan an ultra-premium request returns 403 with a plan-limit error.
export async function proxyFetch(
  targetUrl: string,
  opts: {
    timeoutMs?: number;
    countryCode?: string;
    ultraPremium?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const key = process.env.SCRAPER_API_KEY;
  if (key) {
    const params = new URLSearchParams({ api_key: key, url: targetUrl });
    if (opts.countryCode) params.set("country_code", opts.countryCode);
    if (opts.ultraPremium) params.set("ultra_premium", "true");
    return fetchWithTimeout(`https://api.scraperapi.com/?${params.toString()}`, {
      timeoutMs: opts.timeoutMs,
    });
  }
  // No proxy configured — direct fetch (residential dev machine, or accept the
  // 403 in prod and let the caller degrade).
  return fetchWithTimeout(targetUrl, { headers: opts.headers, timeoutMs: opts.timeoutMs });
}
