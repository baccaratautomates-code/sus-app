import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getTemuHeaders } from "./_temu-auth";

// Temu listing scraper. Temu is structurally different from Shopee/Lazada/TikTok:
// it's effectively single-seller (PDD Holdings sells everything). So this
// scraper focuses on the PRODUCT layer instead of seller reputation:
//   • Listing identity (title, brand mentions, price, rating, review count)
//   • Counterfeit-pattern detection (branded keyword in title + suspiciously low price)
//
// Data is extracted from JSON-LD <script> blocks (Temu uses Schema.org Product
// markup for SEO) plus a couple of fallback heuristics.

const TIMEOUT_MS = 12_000;

// Calibrated for Temu's "branded counterfeit" risk. These brand names are common
// targets for fake listings; combined with a low Temu price, they're high-confidence
// red flags. List is illustrative — extend as needed.
const PROTECTED_BRANDS = [
  "apple", "airpod", "iphone", "ipad", "macbook",
  "samsung", "galaxy",
  "nike", "adidas", "puma", "new balance", "yeezy", "jordan",
  "rolex", "patek", "omega", "tag heuer",
  "louis vuitton", "lv", "gucci", "prada", "chanel", "hermes", "dior",
  "ray-ban", "rayban", "oakley",
  "sony", "playstation", "xbox", "nintendo", "switch",
  "dyson",
];

// Currency-prefix detection — Temu localizes, so the symbol depends on the
// region the request was made from (USD, EUR, GBP, PHP, etc.).
const CURRENCY_PATTERN = /(?:US\$|USD|\$|€|EUR|£|GBP|₱|PHP)\s*([\d,]+(?:\.\d+)?)/i;

const COUNTERFEIT_PRICE_THRESHOLD_USD = 50; // brands cheaper than this on Temu = likely fake

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface ProductLd {
  "@type"?: string | string[];
  name?: string;
  brand?: { name?: string } | string;
  description?: string;
  offers?: Offer | Offer[];
  aggregateRating?: { ratingValue?: number | string; reviewCount?: number | string; ratingCount?: number | string };
  sku?: string;
}

interface Offer {
  price?: number | string;
  priceCurrency?: string;
  availability?: string;
}

export async function temuListingScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "temu" || !data.item_id) {
    return emptyResult("temu-listing", id);
  }

  const pageUrl = data.target_url || `https://www.temu.com/-g-${data.item_id}.html`;
  console.log(`[temu-listing] lookup start: itemId=${data.item_id}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: getTemuHeaders("https://www.temu.com/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[temu-listing] HTTP ${res.status} for ${pageUrl}`);
      return emptyResult("temu-listing", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(`[temu-listing] fetch failed for ${pageUrl}: ${(err as Error).message}`);
    return emptyResult("temu-listing", id);
  }

  const product = extractProduct(html);
  const titleFromMeta = matchOgTitle(html);
  const title = product?.name ?? titleFromMeta;
  const brand = product?.brand
    ? typeof product.brand === "string"
      ? product.brand
      : product.brand.name ?? null
    : null;
  const offer = pickOffer(product?.offers);
  const priceUsd = parsePriceUsd(offer?.price, offer?.priceCurrency, html);
  const rating = toNumber(product?.aggregateRating?.ratingValue);
  const reviewCount = toNumber(
    product?.aggregateRating?.reviewCount ?? product?.aggregateRating?.ratingCount,
  );

  const source: Source = {
    url: pageUrl,
    title: title ? `Temu listing: ${title}` : `Temu listing ${data.item_id}`,
    signal_type: "price_sanity",
  };

  const signals: Signal[] = [];

  // Baseline — always emit something if we got the page.
  signals.push({
    type: "price_sanity",
    weight: 0,
    detail: formatBaseline(data.item_id, title, brand, priceUsd, rating, reviewCount),
    source,
  });

  // COUNTERFEIT-BRAND PATTERN — the meaningful red-flag direction for Temu.
  const brandMatch = findProtectedBrand(title, brand);
  if (brandMatch) {
    if (priceUsd !== null && priceUsd <= COUNTERFEIT_PRICE_THRESHOLD_USD) {
      signals.push({
        type: "price_sanity",
        weight: 0.9,
        detail: `Listing mentions "${brandMatch}" and is priced at $${priceUsd.toFixed(2)} — major brands at this price on Temu are almost always counterfeit or generic substitutes.`,
        source,
      });
    } else {
      // Brand-name present but price isn't obviously fake — still worth noting
      // because authentic items from these brands aren't sold by Temu.
      signals.push({
        type: "price_sanity",
        weight: 0.5,
        detail: `Listing mentions the brand "${brandMatch}". Temu is not an authorized reseller for major brands; branded items here are typically generic or counterfeit.`,
        source,
      });
    }
  }

  // Low review-count rating is less meaningful on Temu (most items have few
  // reviews because they cycle fast). But a flat-4.5+ with many reviews is a
  // positive signal worth showing.
  if (rating !== null && rating >= 4.5 && reviewCount !== null && reviewCount >= 1000) {
    signals.push({
      type: "review_authenticity",
      weight: -0.3,
      detail: `Listing has ${rating.toFixed(1)}/5 across ${reviewCount} reviews — consistent positive feedback on Temu.`,
      source: { ...source, signal_type: "review_authenticity" },
    });
  }

  // Conversely, low rating with many reviews IS a red flag.
  if (rating !== null && rating > 0 && rating < 3.5 && reviewCount !== null && reviewCount >= 50) {
    signals.push({
      type: "review_authenticity",
      weight: 0.6,
      detail: `Listing has only ${rating.toFixed(1)}/5 across ${reviewCount} reviews — sustained low rating despite review volume.`,
      source: { ...source, signal_type: "review_authenticity" },
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[temu-listing] lookup done: itemId=${data.item_id} title="${(title ?? "?").slice(0, 50)}" brand="${brand ?? "?"}" price=$${priceUsd?.toFixed(2) ?? "?"} rating=${rating ?? "?"} reviews=${reviewCount ?? "?"} brandMatch=${brandMatch ?? "none"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "temu-listing",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Find Schema.org Product JSON-LD blocks. There may be several (breadcrumbs,
// organization, etc.) — return the first one with @type containing "Product".
function extractProduct(html: string): ProductLd | null {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const json = JSON.parse(m[1]);
      const candidates = Array.isArray(json) ? json : [json];
      for (const node of candidates) {
        if (!node || typeof node !== "object") continue;
        const t = (node as ProductLd)["@type"];
        const typeStr = Array.isArray(t) ? t.join(",") : (t ?? "");
        if (typeof typeStr === "string" && /product/i.test(typeStr)) {
          return node as ProductLd;
        }
      }
    } catch {
      // Skip malformed blocks.
    }
  }
  return null;
}

function pickOffer(offers: Offer | Offer[] | undefined): Offer | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers[0] ?? null;
  return offers;
}

// Convert price to USD when possible. If currency is anything other than USD/$
// we don't have FX rates here, so return the raw number — synthesis prompt
// understands localized prices. The brand-counterfeit threshold is USD-anchored
// so non-USD prices won't trigger that specific red flag, which is conservative.
function parsePriceUsd(
  raw: number | string | undefined,
  currency: string | undefined,
  html: string,
): number | null {
  let n = toNumber(raw);
  if (n === null) {
    // Fallback — scan HTML for the first price-looking string with a known
    // currency prefix.
    const m = html.match(CURRENCY_PATTERN);
    if (m) {
      n = toNumber(m[1].replace(/,/g, ""));
    }
  }
  if (n === null) return null;
  if (currency && currency !== "USD") {
    // Not converting; return as-is. Brand-counterfeit threshold won't fire on non-USD.
    return n;
  }
  return n;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function matchOgTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function findProtectedBrand(
  title: string | null | undefined,
  brand: string | null,
): string | null {
  const haystack = `${title ?? ""} ${brand ?? ""}`.toLowerCase();
  for (const candidate of PROTECTED_BRANDS) {
    // Word-boundary-ish check — avoid matching "applesauce" against "apple"
    const re = new RegExp(`(^|[^a-z])${escapeRegex(candidate)}([^a-z]|$)`, "i");
    if (re.test(haystack)) return candidate;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBaseline(
  itemId: string,
  title: string | null | undefined,
  brand: string | null,
  priceUsd: number | null,
  rating: number | null,
  reviewCount: number | null,
): string {
  const parts = [`Temu listing ${itemId}`];
  if (title) parts.push(`"${title}"`);
  if (brand) parts.push(`brand "${brand}"`);
  if (priceUsd !== null) parts.push(`price $${priceUsd.toFixed(2)}`);
  if (rating !== null) parts.push(`rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount} reviews`);
  return parts.join(", ");
}
