import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

const USER_AGENT = "Mozilla/5.0 (compatible; sus-app/0.1)";
const LOW_RATING_THRESHOLD = 2.0;
const LOW_REVIEW_COUNT_THRESHOLD = 10;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface ParsedRating {
  rating: number | null;
  reviewCount: number | null;
}

export async function trustpilotScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[trustpilot] no domain — empty result`);
    return emptyResult("trustpilot", id);
  }

  console.log(`[trustpilot] lookup start: ${domain}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(`https://www.trustpilot.com/review/${domain}`, {
      headers: { "User-Agent": USER_AGENT, accept: "text/html" },
      timeoutMs: 10_000,
    });
    if (res.status === 404) {
      console.log(`[trustpilot] no review page for ${domain} (404)`);
      return emptyResult("trustpilot", id);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error(`[trustpilot] fetch failed for ${domain}: ${(err as Error).message}`);
    return emptyResult("trustpilot", id);
  }

  const { rating, reviewCount } = parseAggregateRating(html);

  const source: Source = {
    url: `https://www.trustpilot.com/review/${domain}`,
    title: `Trustpilot reviews for ${domain}`,
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: `Trustpilot for ${domain}: rating ${rating ?? "?"}/5, reviews ${reviewCount ?? "?"}.`,
      source,
    },
  ];

  if (rating !== null && rating < LOW_RATING_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.8,
      detail: `Trustpilot rating is ${rating}/5 — below the ${LOW_RATING_THRESHOLD} threshold.`,
      source,
    });
  }

  if (reviewCount !== null && reviewCount < LOW_REVIEW_COUNT_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.6,
      detail: `Only ${reviewCount} Trustpilot reviews — limited reputation history.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[trustpilot] lookup done: ${domain} rating=${rating ?? "?"} count=${reviewCount ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "trustpilot",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Extract aggregateRating from JSON-LD <script> blocks. Trustpilot uses
// schema.org Organization markup; ratingValue/reviewCount are stringified numbers.
function parseAggregateRating(html: string): ParsedRating {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const json = JSON.parse(m[1]);
      const candidates = Array.isArray(json) ? json : [json];
      for (const node of candidates) {
        const agg = node?.aggregateRating;
        if (agg && (agg.ratingValue !== undefined || agg.reviewCount !== undefined)) {
          return {
            rating: numberOrNull(agg.ratingValue),
            reviewCount: numberOrNull(agg.reviewCount),
          };
        }
      }
    } catch {
      // Skip non-JSON or malformed blocks
    }
  }
  return { rating: null, reviewCount: null };
}

function numberOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
