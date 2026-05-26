import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

// Scrapes the public Scamadviser report page directly — no paid API key required.
// The page is server-rendered for SEO so the trust score is in the HTML, but the
// exact markup changes occasionally; multiple fallback parsers below.

const USER_AGENT = "Mozilla/5.0 (compatible; sus-app/0.1)";
const PAGE_TIMEOUT_MS = 10_000;
const LOW_TRUST_THRESHOLD = 50;
const HIGH_TRUST_THRESHOLD = 80;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function scamadviserScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[scamadviser] no domain from target_url="${data.target_url}" — empty result`);
    return emptyResult("scamadviser", id);
  }

  console.log(`[scamadviser] lookup start: ${domain}`);
  const startedAt = Date.now();

  const pageUrl = `https://www.scamadviser.com/check-website/${domain}`;

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: { "User-Agent": USER_AGENT, accept: "text/html" },
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[scamadviser] HTTP ${res.status} for ${domain}`);
      return emptyResult("scamadviser", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(`[scamadviser] fetch failed for ${domain}: ${(err as Error).message}`);
    return emptyResult("scamadviser", id);
  }

  const trustScore = parseTrustScore(html);

  const source: Source = {
    url: pageUrl,
    title: `Scamadviser report for ${domain}`,
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [];

  // Only emit signals when we have a parseable numeric trust score. The page's
  // meta description and verdict text are marketing boilerplate ("Check x.com
  // with our free review tool…") that contains generic words like "scams" and
  // confuses synthesis into red-flagging legitimate domains. Score-only output
  // is noisier-but-correct vs verdict-text-included which is louder-but-wrong.
  if (trustScore !== null) {
    signals.push({
      type: "seller_reputation",
      weight: 0,
      detail: `Scamadviser trust score for ${domain}: ${trustScore}/100.`,
      source,
    });

    if (trustScore < LOW_TRUST_THRESHOLD) {
      signals.push({
        type: "seller_reputation",
        weight: 0.8,
        detail: `Scamadviser trust score is ${trustScore}/100 — below the ${LOW_TRUST_THRESHOLD} threshold typical for legitimate domains.`,
        source,
      });
    } else if (trustScore >= HIGH_TRUST_THRESHOLD) {
      // Surface a positive signal too. Synthesis needs both polarities to
      // calibrate properly — without this, high-trust domains were being
      // treated as "neutral" rather than "good".
      signals.push({
        type: "seller_reputation",
        weight: -0.5, // negative weight = green-flag-direction
        detail: `Scamadviser trust score is ${trustScore}/100 — strong positive trust rating.`,
        source,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[scamadviser] lookup done: ${domain} trust=${trustScore ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "scamadviser",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Scamadviser exposes the trust score in several places. Try the most stable first
// (JSON-LD), then fall back to inline JSON, data-attributes, meta tags, and title.
function parseTrustScore(html: string): number | null {
  // 1. JSON-LD structured data (Schema.org Review or Rating)
  const jsonLdBlocks = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const m of jsonLdBlocks) {
    try {
      const node = JSON.parse(m[1]);
      const candidates = Array.isArray(node) ? node : [node];
      for (const c of candidates) {
        const v = c?.aggregateRating?.ratingValue ?? c?.reviewRating?.ratingValue;
        const n = sanitizeScore(v);
        if (n !== null) return n;
      }
    } catch {
      // Skip malformed JSON-LD blocks.
    }
  }

  // 2. Inline JSON state ("trust_score": 85, "trustScore":85, etc.)
  const inlineJson = html.match(/["']?trust[_\s]?score["']?\s*[:=]\s*(\d{1,3})/i);
  if (inlineJson) {
    const n = sanitizeScore(inlineJson[1]);
    if (n !== null) return n;
  }

  // 3. data-* attribute: <div data-score="85"> or data-trust-score
  const dataAttr = html.match(/data-(?:trust-)?score\s*=\s*["'](\d{1,3})["']/i);
  if (dataAttr) {
    const n = sanitizeScore(dataAttr[1]);
    if (n !== null) return n;
  }

  // 4. Meta description: "...trust score 85/100..."
  const meta = matchMetaDescription(html);
  if (meta) {
    const m = meta.match(/trust\s*score[:\s]+(\d{1,3})/i);
    if (m) {
      const n = sanitizeScore(m[1]);
      if (n !== null) return n;
    }
  }

  // 5. Title tag: "Scamadviser: shein.com (85/100)"
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) {
    const m = title[1].match(/(\d{1,3})\s*\/\s*100/);
    if (m) {
      const n = sanitizeScore(m[1]);
      if (n !== null) return n;
    }
  }

  return null;
}

// Helper: try various locations to find the numeric trust score. Used above.
function matchMetaDescription(html: string): string | null {
  const m = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  );
  return m ? m[1] : null;
}

function sanitizeScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return Math.round(n);
}
