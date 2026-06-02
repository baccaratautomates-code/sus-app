import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, proxyFetch } from "./_lib";

// Lazada PH product scraper.
//
// HISTORY:
//  • Lazada used to embed product+seller+review data in the page as
//    `window.runParams = {...}`. That's gone — the page is now a client shell.
//  • Lazada also 403s / anti-bot-captchas any datacenter IP (e.g. Railway), so
//    even fetching the page server-side returns nothing in production.
//
// SOLUTION: hit Lazada's review endpoint
//   https://my.lazada.com.ph/pdp/review/getReviewList?itemId=<id>&...
// through ScraperAPI (residential IP, country_code=ph) — see proxyFetch(). That
// single JSON call carries everything we need for a seller-reputation verdict:
//   • ratings.average, ratings.reviewCount, ratings.scores (1–5★ histogram)
//   • item.itemTitle, item.productPrice, item.sellerId
// It returns in ~2s through the proxy. We deliberately DON'T fetch the full
// product page (it's ~250KB and takes ~40s through the proxy — blows the 25s
// scan budget) so we lose the JSON-LD brand-store badge; the rating + review
// volume is the load-bearing signal and that's enough.

const REVIEW_TIMEOUT_MS = 20_000; // proxy adds latency; scan budget is 25s

// PH marketplace ratings cluster high — same calibration as the Shopee scraper.
const LOW_ITEM_RATING_THRESHOLD = 4.0;
const HIGH_RATING_THRESHOLD = 4.5;
const ESTABLISHED_REVIEW_COUNT = 100;
const SPARSE_REVIEW_COUNT = 10;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

// Subset of the my.lazada.com.ph/pdp/review/getReviewList response we read.
// Probed defensively — Lazada changes these without notice.
interface LazadaReviewResponse {
  success?: boolean;
  model?: {
    paging?: { totalItems?: number };
    item?: {
      sellerId?: number | string;
      sellerName?: string | null;
      itemTitle?: string;
      productPrice?: string;
      categoryName?: string;
    };
    ratings?: {
      average?: number | string;
      rateCount?: number | string;
      reviewCount?: number | string;
      scores?: number[]; // [5★, 4★, 3★, 2★, 1★] counts
    };
  };
}

export async function lazadaProductScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "lazada-ph" || !data.item_id) {
    return emptyResult("lazada-product", id);
  }

  const pageUrl = data.target_url || `https://www.lazada.com.ph/products/-i${data.item_id}.html`;
  console.log(`[lazada-product] lookup start: itemId=${data.item_id}`);
  const startedAt = Date.now();

  const review = await fetchReviews(data.item_id, pageUrl);
  if (!review) {
    console.warn(`[lazada-product] no review data for itemId=${data.item_id}`);
    return emptyResult("lazada-product", id);
  }

  const item = review.model?.item;
  const ratings = review.model?.ratings;
  const productTitle = item?.itemTitle ?? undefined;
  const sellerId = String(item?.sellerId ?? "");
  const sellerName = item?.sellerName ?? undefined;
  const price = parsePesoPrice(item?.productPrice);
  const itemRating = toNumber(ratings?.average);
  const reviewCount =
    toNumber(ratings?.reviewCount) ??
    toNumber(ratings?.rateCount) ??
    toNumber(review.model?.paging?.totalItems);

  // Nothing usable (e.g. brand-new listing with zero reviews) — return empty so
  // synthesis honestly reports "Not Enough Info" rather than us inventing data.
  if (!productTitle && itemRating === null && reviewCount === null) {
    console.warn(`[lazada-product] review payload had no usable fields for itemId=${data.item_id}`);
    return emptyResult("lazada-product", id);
  }

  const sellerSource: Source = {
    url: sellerId ? `https://www.lazada.com.ph/shop/?sellerId=${sellerId}` : pageUrl,
    title: sellerName ? `Lazada seller: ${sellerName}` : `Lazada seller ${sellerId || "(unknown)"}`,
    signal_type: "seller_reputation",
  };
  const listingSource: Source = {
    url: pageUrl,
    title: productTitle ? `Lazada listing: ${productTitle}` : `Lazada listing ${data.item_id}`,
    signal_type: "price_sanity",
  };

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: formatSellerBaseline(sellerName, sellerId, itemRating, reviewCount),
      source: sellerSource,
    },
    {
      type: "price_sanity",
      weight: 0,
      detail: formatListingBaseline(productTitle, price, itemRating, reviewCount),
      source: listingSource,
    },
  ];

  // Positive: an established listing with a high rating across many reviews is
  // real, citable evidence the seller delivers. Negative weight = trust-positive
  // (same sign convention as the Shopee scraper).
  if (
    itemRating !== null &&
    itemRating >= HIGH_RATING_THRESHOLD &&
    reviewCount !== null &&
    reviewCount >= ESTABLISHED_REVIEW_COUNT
  ) {
    signals.push({
      type: "seller_reputation",
      weight: -0.6,
      detail: `Listing holds a ${itemRating.toFixed(2)}/5 rating across ${reviewCount.toLocaleString()} reviews — an established track record, not a brand-new listing.`,
      source: sellerSource,
    });
  }

  // Negative: low rating.
  if (itemRating !== null && itemRating > 0 && itemRating < LOW_ITEM_RATING_THRESHOLD) {
    signals.push({
      type: "review_authenticity",
      weight: 0.5,
      detail: `Listing rating is ${itemRating.toFixed(2)}/5 across ${reviewCount ?? "?"} reviews — below the ${LOW_ITEM_RATING_THRESHOLD}/5 threshold typical for established Lazada listings.`,
      source: { ...listingSource, signal_type: "review_authenticity" },
    });
  }

  // Negative: sparse reviews mean little public track record to judge by.
  if (reviewCount !== null && reviewCount < SPARSE_REVIEW_COUNT) {
    signals.push({
      type: "seller_reputation",
      weight: 0.4,
      detail: `Listing has only ${reviewCount} review${reviewCount === 1 ? "" : "s"} — limited public track record to judge the seller by.`,
      source: sellerSource,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[lazada-product] lookup done: itemId=${data.item_id} seller="${sellerName ?? "?"}" sellerId=${sellerId || "?"} listing="${productTitle ?? "?"}" price=${price ?? "?"} rating=${itemRating ?? "?"} reviews=${reviewCount ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "lazada-product",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Calls the review API through the residential proxy. Returns null on any
// failure (HTTP error, anti-bot punish page, non-JSON body, success:false) so
// the caller degrades to an empty result rather than throwing.
async function fetchReviews(itemId: string, pageUrl: string): Promise<LazadaReviewResponse | null> {
  const reviewUrl = `https://my.lazada.com.ph/pdp/review/getReviewList?itemId=${encodeURIComponent(itemId)}&pageSize=3&filter=0&sort=0`;
  try {
    const res = await proxyFetch(reviewUrl, {
      countryCode: "ph",
      timeoutMs: REVIEW_TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "en-PH,en;q=0.9",
        Referer: pageUrl,
        Accept: "application/json, text/plain, */*",
      },
    });
    if (!res.ok) {
      console.warn(`[lazada-product] review API HTTP ${res.status} for itemId=${itemId}`);
      return null;
    }
    const text = await res.text();
    if (isPunishPage(text)) {
      console.warn(`[lazada-product] review API anti-bot punish for itemId=${itemId}`);
      return null;
    }
    const json = JSON.parse(text) as LazadaReviewResponse;
    if (!json.success) {
      console.warn(`[lazada-product] review API success=false for itemId=${itemId}`);
      return null;
    }
    return json;
  } catch (err) {
    console.warn(`[lazada-product] review API failed for itemId=${itemId}: ${(err as Error).message}`);
    return null;
  }
}

function isPunishPage(text: string): boolean {
  return (
    text.includes("_____tmd_____") ||
    text.includes("x5secdata") ||
    /"action"\s*:\s*"captcha"/.test(text)
  );
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// Parses a Lazada price string like "₱10,699.00" → 10699.
function parsePesoPrice(v: unknown): number | null {
  if (typeof v !== "string") return toNumber(v);
  const cleaned = v.replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatSellerBaseline(
  name: string | undefined,
  id: string,
  rating: number | null,
  reviewCount: number | null,
): string {
  const parts = [`Lazada seller ${name ? `"${name}"` : id || "(unknown)"}`];
  if (rating !== null) parts.push(`listing rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount.toLocaleString()} reviews`);
  return parts.join(", ");
}

function formatListingBaseline(
  title: string | undefined,
  price: number | null,
  rating: number | null,
  reviewCount: number | null,
): string {
  const parts = [`Lazada listing ${title ? `"${title}"` : "(no title)"}`];
  if (price !== null) parts.push(`price ₱${price.toFixed(2)}`);
  if (rating !== null) parts.push(`rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount.toLocaleString()} reviews`);
  return parts.join(", ");
}
