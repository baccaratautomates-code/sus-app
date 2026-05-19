import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";

const SERPAPI_URL = "https://serpapi.com/search.json";
const MAX_RESULTS = 10;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface SerpShoppingResult {
  title?: string;
  price?: string;
  source?: string;
  link?: string;
}

interface SerpResponse {
  shopping_results?: SerpShoppingResult[];
}

export async function priceSanityScraper({
  id,
  data,
}: ScraperInput): Promise<ScrapeResult> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn("[price-sanity] SERPAPI_KEY not set — empty result");
    return emptyResult("price-sanity", id);
  }

  const query = inferQuery(data);
  if (!query) {
    console.warn(`[price-sanity] no query inferable from "${data.target_url}" — empty result`);
    return emptyResult("price-sanity", id);
  }

  console.log(`[price-sanity] lookup start: query="${query}"`);
  const startedAt = Date.now();

  let body: SerpResponse;
  try {
    const url = `${SERPAPI_URL}?engine=google_shopping&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, {
      headers: { accept: "application/json" },
      timeoutMs: 10_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as SerpResponse;
  } catch (err) {
    console.error(`[price-sanity] fetch failed: ${(err as Error).message}`);
    return emptyResult("price-sanity", id);
  }

  const prices = (body.shopping_results ?? [])
    .slice(0, MAX_RESULTS)
    .map((r) => parsePrice(r.price))
    .filter((p): p is number => p !== null);

  const source: Source = {
    url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`,
    title: `Google Shopping for "${query}"`,
    signal_type: "price_sanity",
  };

  const signals: Signal[] = [];

  if (prices.length === 0) {
    signals.push({
      type: "price_sanity",
      weight: 0,
      detail: `No comparable Google Shopping results for "${query}".`,
      source,
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(`[price-sanity] lookup done: query="${query}" results=0 (${elapsedMs}ms)`);
    return {
      source: "price-sanity",
      job_id: id,
      signals,
      scraped_at: new Date().toISOString(),
    };
  }

  const median = medianOf(prices);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  signals.push({
    type: "price_sanity",
    weight: 0,
    detail: `Google Shopping median for "${query}" is $${median.toFixed(2)} across ${prices.length} listings (range $${min.toFixed(2)}–$${max.toFixed(2)}).`,
    source,
  });

  const listedPrice = inferListedPrice(data);
  if (listedPrice !== null && listedPrice < median * 0.5) {
    signals.push({
      type: "price_sanity",
      weight: 0.9,
      detail: `Listed price $${listedPrice.toFixed(2)} is more than 50% below market median $${median.toFixed(2)} — common counterfeit signal.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[price-sanity] lookup done: query="${query}" median=$${median.toFixed(2)} listed=${listedPrice ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "price-sanity",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Use ScrapeJob.product if upstream extraction sets it; otherwise tokenize the URL path
// as a fallback. Many e-commerce URLs encode the product name in the path.
function inferQuery(data: ScrapeJob): string | null {
  if (data.product && data.product.trim().length > 0) return data.product;
  try {
    const url = new URL(data.target_url);
    const tokens = url.pathname
      .split(/[\/\-_]+/)
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
    return tokens.length > 0 ? tokens.slice(0, 6).join(" ") : null;
  } catch {
    return null;
  }
}

// TODO: extract listed price from target_url scrape — needs a product-page scraper.
// Returns null until input-normalization (PRD §3.1) is implemented; the >50%-below-
// market signal won't fire until then.
function inferListedPrice(_data: ScrapeJob): number | null {
  return null;
}

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function medianOf(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
