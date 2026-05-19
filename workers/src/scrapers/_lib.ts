// Shared helpers used by multiple scrapers. The leading underscore in the filename
// keeps it out of the alphabetical scraper listing in folder views.
import type { ScrapeResult } from "@sus/shared";

export function extractDomain(input: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(withScheme);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
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
