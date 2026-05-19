import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

// Note: this scraper independently fetches the Trustpilot review page — each scraper
// runs as an isolated BullMQ job so there's no shared state with trustpilot.ts. The
// 2× HTTP cost is accepted for now; if it becomes a problem, share via a Redis cache
// keyed on domain with a short TTL.

const USER_AGENT = "Mozilla/5.0 (compatible; sus-app/0.1)";
const VELOCITY_WINDOW_HOURS = 48;
const VELOCITY_THRESHOLD = 10;
const REPETITION_THRESHOLD = 0.3;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface Review {
  createdAt: number; // ms since epoch
  text: string;
}

export async function reviewAuthenticityScraper({
  id,
  data,
}: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[review-authenticity] no domain — empty result`);
    return emptyResult("review-authenticity", id);
  }

  console.log(`[review-authenticity] lookup start: ${domain}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(`https://www.trustpilot.com/review/${domain}`, {
      headers: { "User-Agent": USER_AGENT, accept: "text/html" },
      timeoutMs: 10_000,
    });
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[review-authenticity] HTTP ${res.status} for ${domain}`);
      }
      return emptyResult("review-authenticity", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(
      `[review-authenticity] fetch failed for ${domain}: ${(err as Error).message}`,
    );
    return emptyResult("review-authenticity", id);
  }

  const reviews = extractReviews(html);
  if (reviews.length === 0) {
    console.log(`[review-authenticity] no reviews extractable for ${domain}`);
    return emptyResult("review-authenticity", id);
  }

  const source: Source = {
    url: `https://www.trustpilot.com/review/${domain}`,
    title: `Trustpilot reviews for ${domain}`,
    signal_type: "review_authenticity",
  };

  const signals: Signal[] = [
    {
      type: "review_authenticity",
      weight: 0,
      detail: `Analyzed ${reviews.length} recent Trustpilot reviews for ${domain}.`,
      source,
    },
  ];

  const now = Date.now();
  const windowMs = VELOCITY_WINDOW_HOURS * 3600 * 1000;
  const recentCount = reviews.filter((r) => now - r.createdAt < windowMs).length;
  if (recentCount > VELOCITY_THRESHOLD) {
    signals.push({
      type: "review_authenticity",
      weight: 0.7,
      detail: `${recentCount} reviews in the last ${VELOCITY_WINDOW_HOURS}h — abnormal velocity spike (Fakespot-style signal).`,
      source,
    });
  }

  const repetition = repetitionRatio(reviews);
  if (repetition > REPETITION_THRESHOLD) {
    signals.push({
      type: "review_authenticity",
      weight: 0.6,
      detail: `${Math.round(repetition * 100)}% of reviews share near-identical text — generic/repetitive content suggests review-mill activity.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[review-authenticity] lookup done: ${domain} reviews=${reviews.length} recent=${recentCount} repetition=${(repetition * 100).toFixed(0)}% signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "review-authenticity",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Trustpilot is a Next.js app — review data lives in the __NEXT_DATA__ blob.
// The exact JSON path is brittle; try a few known shapes.
function extractReviews(html: string): Review[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    const raw =
      data?.props?.pageProps?.reviews ??
      data?.props?.pageProps?.businessUnit?.reviews ??
      [];
    if (!Array.isArray(raw)) return [];

    return raw
      .map((r: Record<string, unknown>): Review | null => {
        const text =
          (typeof r?.text === "string" && r.text) ||
          (typeof r?.title === "string" && r.title) ||
          null;
        const dates = (r?.dates as Record<string, unknown> | undefined) ?? {};
        const dateStr =
          (typeof dates.publishedDate === "string" && dates.publishedDate) ||
          (typeof r?.createdAt === "string" && r.createdAt) ||
          (typeof r?.dateCreated === "string" && r.dateCreated) ||
          "";
        const createdAt = Date.parse(dateStr);
        if (!text || !Number.isFinite(createdAt)) return null;
        return { text, createdAt };
      })
      .filter((r): r is Review => r !== null);
  } catch {
    return [];
  }
}

// Fraction of reviews whose first 80 chars (case+whitespace-normalized) match another.
function repetitionRatio(reviews: Review[]): number {
  if (reviews.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const r of reviews) {
    const key = r.text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = [...counts.values()].filter((c) => c > 1).reduce((a, b) => a + b, 0);
  return duplicates / reviews.length;
}
