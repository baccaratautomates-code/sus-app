import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

// Wayback Machine (archive.org) — free, no auth, no rate-key required.
// The CDX index returns the earliest snapshot of a domain in milliseconds.
// Brand-new dropshipper sites usually have no archive history at all, which
// is one of the strongest "this seller just appeared" signals available for free.

const CDX_URL = "https://web.archive.org/cdx/search/cdx";
const USER_AGENT = "sus-app/0.1 (https://github.com/disruptorsmedia/sus)";
const TIMEOUT_MS = 10_000;
const NEW_DOMAIN_THRESHOLD_DAYS = 90;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function waybackScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[wayback] no domain from target_url="${data.target_url}" — empty result`);
    return emptyResult("wayback", id);
  }

  console.log(`[wayback] lookup start: ${domain}`);
  const startedAt = Date.now();

  // matchType=domain catches snapshots of any host under the registrable domain
  // (shein.com, www.shein.com, ph.shein.com, …). limit=1 with default ascending
  // sort gives us the earliest snapshot across all of them in one query.
  const cdxUrl =
    `${CDX_URL}?url=${encodeURIComponent(domain)}&matchType=domain&output=json&limit=1&fl=timestamp`;

  let earliestTimestamp: string | null = null;
  try {
    const res = await fetchWithTimeout(cdxUrl, {
      headers: { "User-Agent": USER_AGENT, accept: "application/json" },
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[wayback] HTTP ${res.status} for ${domain}`);
      return emptyResult("wayback", id);
    }
    const body = (await res.json()) as unknown;
    // CDX returns [["timestamp"], ["20180523120000"]] on hit, [] on no snapshots.
    if (Array.isArray(body) && body.length >= 2) {
      const row = body[1];
      if (Array.isArray(row) && typeof row[0] === "string") {
        earliestTimestamp = row[0];
      }
    }
  } catch (err) {
    console.error(`[wayback] fetch failed for ${domain}: ${(err as Error).message}`);
    return emptyResult("wayback", id);
  }

  const firstSnapshot = parseTimestamp(earliestTimestamp);
  const ageDays =
    firstSnapshot !== null
      ? Math.floor((Date.now() - firstSnapshot.getTime()) / 86_400_000)
      : null;

  const source: Source = {
    url: `https://web.archive.org/web/*/${domain}`,
    title: `Wayback Machine archive history for ${domain}`,
    signal_type: "domain",
  };

  const signals: Signal[] = [
    {
      type: "domain",
      weight: 0,
      detail: formatBaseline(domain, firstSnapshot, ageDays),
      source,
    },
  ];

  if (firstSnapshot === null) {
    // No Wayback snapshots at all. Common for very new sites and very obscure
    // ones. Established e-commerce brands always have hundreds of snapshots.
    signals.push({
      type: "domain",
      weight: 0.6,
      detail: `No Wayback Machine archive history found for "${domain}" — established e-commerce sites typically have multiple snapshots.`,
      source,
    });
  } else if (ageDays !== null && ageDays < NEW_DOMAIN_THRESHOLD_DAYS) {
    signals.push({
      type: "domain",
      weight: 0.7,
      detail: `Domain first archived only ${ageDays} days ago — recent web presence, common signal for new dropshipper sites.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[wayback] lookup done: ${domain} first=${firstSnapshot?.toISOString().slice(0, 10) ?? "?"} age=${ageDays ?? "?"}d signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "wayback",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// CDX timestamps are YYYYMMDDhhmmss (or shorter — at least the date portion is always present).
function parseTimestamp(ts: string | null): Date | null {
  if (!ts || ts.length < 8) return null;
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6)) - 1;
  const day = Number(ts.slice(6, 8));
  const hour = ts.length >= 10 ? Number(ts.slice(8, 10)) : 0;
  const minute = ts.length >= 12 ? Number(ts.slice(10, 12)) : 0;
  const second = ts.length >= 14 ? Number(ts.slice(12, 14)) : 0;
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBaseline(
  domain: string,
  firstSnapshot: Date | null,
  ageDays: number | null,
): string {
  if (firstSnapshot === null) {
    return `Wayback Machine: no archive history for ${domain}`;
  }
  return `Wayback Machine: ${domain} first archived ${firstSnapshot.toISOString().slice(0, 10)} (~${ageDays} days ago)`;
}
