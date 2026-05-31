import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getTiktokHeaders } from "./_tiktok-auth";

// TikTok Shop product-page scraper.
//
// Sibling of `tiktok-shop.ts` (creator profile) — that one only fires when the
// URL exposes a @username, which TikTok Shop product URLs (shop-XX.tiktok.com/
// view/product/<id>) don't. Without a product scraper those listings landed in
// "Not Enough Info" because no source had anything to say about them.
//
// We pull product-level signals out of the universal-data JSON blob that
// TikTok embeds in the page HTML for client hydration. The blob's shape moves
// every couple of months, so we walk the tree defensively looking for known
// field names rather than depending on a stable path.
//
// Signals we try to emit:
//   • Baseline ("we checked TikTok Shop") — always, so synthesis knows the
//     source ran even when extraction fails
//   • Sold count (high = positive social proof, low/zero = weak signal)
//   • Rating + review count (good rating with substantial reviews = positive)
//   • TikTok Shop Guarantee / refundable / official-shop badge presence
//   • Seller verification badge
//
// All defensive — if a field isn't present we just don't emit that signal.

const TIMEOUT_MS = 12_000;

// Thresholds — calibrated for PH consumer-electronics + apparel listings,
// where 13K+ sold is a credible "popular item" and <50 sold on a months-old
// listing is a yellow flag.
const HIGH_SOLD_COUNT = 1_000;
const LOW_SOLD_COUNT = 50;
const HIGH_RATING = 4.5;
const LOW_RATING = 3.5;
const MIN_REVIEWS_FOR_RATING_SIGNAL = 30;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface ExtractedProduct {
  title: string | null;
  sold: number | null;
  rating: number | null;
  reviewCount: number | null;
  sellerName: string | null;
  sellerVerified: boolean;
  shopGuarantee: boolean;
}

export async function tiktokProductScraper({
  id,
  data,
}: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "tiktok-shop") {
    return emptyResult("tiktok-product", id);
  }

  // Only fires for actual product pages — creator-profile URLs are handled by
  // tiktok-shop.ts. We detect product pages either by an item_id (extracted
  // in normalize.ts for shop-subdomain URLs) or by the URL path containing
  // /product/<digits>.
  const isProductPage =
    data.item_id !== null || /\/product\/\d+/i.test(data.target_url);
  if (!isProductPage) {
    return emptyResult("tiktok-product", id);
  }

  console.log(`[tiktok-product] lookup start: ${data.target_url}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(data.target_url, {
      headers: getTiktokHeaders("https://www.tiktok.com/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[tiktok-product] HTTP ${res.status} for ${data.target_url}`);
      return emptyResult("tiktok-product", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(
      `[tiktok-product] fetch failed for ${data.target_url}: ${(err as Error).message}`,
    );
    return emptyResult("tiktok-product", id);
  }

  const product = extractProduct(html);
  const source: Source = {
    url: data.target_url,
    title: product?.title
      ? `TikTok Shop: ${product.title}`
      : `TikTok Shop product`,
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(product),
      source,
    },
  ];

  if (!product) {
    console.warn(
      `[tiktok-product] no parseable product data for ${data.target_url}`,
    );
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[tiktok-product] lookup done: extracted=false signals=${signals.length} (${elapsedMs}ms)`,
    );
    return {
      source: "tiktok-product",
      job_id: id,
      signals,
      scraped_at: new Date().toISOString(),
    };
  }

  // --- Sold-count signals
  if (product.sold !== null && product.sold >= HIGH_SOLD_COUNT) {
    signals.push({
      type: "seller_reputation",
      weight: -0.5,
      detail: `Listing has ${product.sold.toLocaleString()} units sold — strong social proof on TikTok Shop.`,
      source,
    });
  } else if (product.sold !== null && product.sold < LOW_SOLD_COUNT) {
    signals.push({
      type: "seller_reputation",
      weight: 0.3,
      detail: `Listing has only ${product.sold} units sold — limited social proof. New or low-traffic listing.`,
      source,
    });
  }

  // --- Rating signals (only when the review count is substantial enough that
  // the rating is meaningful — a 5-star rating from 3 reviews is noise).
  if (
    product.rating !== null &&
    product.reviewCount !== null &&
    product.reviewCount >= MIN_REVIEWS_FOR_RATING_SIGNAL
  ) {
    if (product.rating >= HIGH_RATING) {
      signals.push({
        type: "seller_reputation",
        weight: -0.4,
        detail: `Rated ${product.rating.toFixed(1)}/5 across ${product.reviewCount.toLocaleString()} reviews on TikTok Shop.`,
        source,
      });
    } else if (product.rating <= LOW_RATING) {
      signals.push({
        type: "seller_reputation",
        weight: 0.5,
        detail: `Rated ${product.rating.toFixed(1)}/5 across ${product.reviewCount.toLocaleString()} reviews on TikTok Shop — below average.`,
        source,
      });
    }
  }

  // --- Platform-level guarantees
  if (product.shopGuarantee) {
    signals.push({
      type: "seller_reputation",
      weight: -0.3,
      detail: `Listing is covered by TikTok Shop Guarantee — TikTok mediates returns/refunds for this seller.`,
      source,
    });
  }
  if (product.sellerVerified) {
    signals.push({
      type: "seller_reputation",
      weight: -0.3,
      detail: `Seller${product.sellerName ? ` "${product.sellerName}"` : ""} is a verified TikTok Shop merchant.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[tiktok-product] lookup done: sold=${product.sold ?? "?"} rating=${product.rating ?? "?"}/${product.reviewCount ?? "?"} guarantee=${product.shopGuarantee} verified=${product.sellerVerified} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "tiktok-product",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

function formatBaseline(product: ExtractedProduct | null): string {
  if (!product) {
    return "TikTok Shop product page fetched, but no public product data was extractable. TikTok limits SSR data.";
  }
  const parts: string[] = ["TikTok Shop product"];
  if (product.title) parts.push(`"${product.title}"`);
  if (product.sold !== null) parts.push(`${product.sold.toLocaleString()} sold`);
  if (product.rating !== null && product.reviewCount !== null) {
    parts.push(`${product.rating.toFixed(1)}/5 across ${product.reviewCount.toLocaleString()} reviews`);
  }
  if (product.sellerName) parts.push(`seller "${product.sellerName}"`);
  if (product.sellerVerified) parts.push("verified seller");
  if (product.shopGuarantee) parts.push("TikTok Shop Guarantee");
  return parts.join(", ") + ".";
}

// Pulls the universal-data blob and walks it looking for product fields.
// Defensive: TikTok rearranges this every few months, so we match by FIELD
// NAME, not by path. Returns null when no plausible product node exists.
function extractProduct(html: string): ExtractedProduct | null {
  const m = html.match(
    /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return null;
  }

  const collected: ExtractedProduct = {
    title: null,
    sold: null,
    rating: null,
    reviewCount: null,
    sellerName: null,
    sellerVerified: false,
    shopGuarantee: false,
  };

  walk(parsed, collected, 0);

  // Require AT LEAST one product field to consider the extraction successful.
  // Otherwise the blob exists but didn't contain product data (e.g. the page
  // was a login wall) and we should fall through to the "no parseable" path.
  const hasAny =
    collected.title !== null ||
    collected.sold !== null ||
    collected.rating !== null ||
    collected.reviewCount !== null ||
    collected.sellerName !== null ||
    collected.shopGuarantee ||
    collected.sellerVerified;
  return hasAny ? collected : null;
}

function walk(node: unknown, out: ExtractedProduct, depth: number): void {
  if (depth > 14) return;
  if (node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) walk(item, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();

    if (typeof value === "string" && value.length > 0) {
      // Common product-title fields. Prefer "title" over "product_name" if both
      // exist (some pages have both with the same content).
      if (
        out.title === null &&
        (k === "title" || k === "product_name" || k === "productname" || k === "product_title")
      ) {
        out.title = value.slice(0, 200);
      }
      if (out.sellerName === null && (k === "shop_name" || k === "seller_name" || k === "shopname" || k === "merchant_name")) {
        out.sellerName = value.slice(0, 80);
      }
    } else if (typeof value === "number") {
      if (out.sold === null && (k === "sold_count" || k === "sales_count" || k === "sale_count" || k === "sold")) {
        out.sold = value;
      }
      // Rating in TikTok blobs is sometimes 0–5 (float) and sometimes 0–50
      // (integer ×10). Normalize to 0–5 if the raw is >10.
      if (out.rating === null && (k === "rating" || k === "average_rating" || k === "product_rating" || k === "avg_rating")) {
        out.rating = value > 10 ? value / 10 : value;
      }
      if (out.reviewCount === null && (k === "review_count" || k === "reviews_count" || k === "rating_count" || k === "comment_count")) {
        out.reviewCount = value;
      }
    } else if (typeof value === "boolean") {
      if (!out.sellerVerified && (k === "verified" || k === "is_verified" || k === "seller_verified")) {
        out.sellerVerified = value;
      }
      if (!out.shopGuarantee && (k === "shop_guarantee" || k === "platform_guarantee" || k === "buyer_protection")) {
        out.shopGuarantee = value;
      }
    }

    walk(value, out, depth + 1);
  }
}
