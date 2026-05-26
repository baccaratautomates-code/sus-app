import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getShopeeHeaders } from "./_shopee-auth";

// Shopee PH product-listing scraper. Hits the internal item-detail API for the
// (shop_id, item_id) pair and turns its fields into product-level trust signals
// — price, review count, sold count, listing age, rating.
//
// Endpoint:
//   https://shopee.ph/api/v4/item/get?shopid=<shop_id>&itemid=<item_id>

const API_URL = "https://shopee.ph/api/v4/item/get";
const TIMEOUT_MS = 10_000;

// Shopee prices are in centi-currency: integer × 100,000 = PHP price.
// So price_min = 12_000_000 means ₱120.00.
const PRICE_SCALE = 100_000;

const LOW_ITEM_RATING_THRESHOLD = 4.0;
const VERY_NEW_LISTING_DAYS = 30;
const HIGH_VIEW_LOW_SOLD_RATIO = 50; // many views, few sold → suspicious

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface ItemData {
  name?: string;
  price?: number;
  price_min?: number;
  price_max?: number;
  price_before_discount?: number;
  currency?: string;
  stock?: number;
  historical_sold?: number;
  liked_count?: number;
  cmt_count?: number;             // review count
  view_count?: number;
  item_rating?: { rating_star?: number; rating_count?: number[]; rating_total?: number };
  ctime?: number;                  // creation time, unix seconds
  raw_discount?: number;
  flag?: number;
  shop_location?: string;
}

interface ItemResponse {
  error?: number;
  data?: ItemData;
}

export async function shopeeListingScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "shopee-ph" || !data.shop_id || !data.item_id) {
    // Only fire on actual product listings. Shop pages (item_id null) skip this.
    return emptyResult("shopee-listing", id);
  }

  const { shop_id: shopId, item_id: itemId } = data;
  console.log(`[shopee-listing] lookup start: shopId=${shopId} itemId=${itemId}`);
  const startedAt = Date.now();

  let body: ItemResponse;
  try {
    const url = `${API_URL}?shopid=${encodeURIComponent(shopId)}&itemid=${encodeURIComponent(itemId)}`;
    const headers = await getShopeeHeaders(`https://shopee.ph/product/${shopId}/${itemId}`);
    const res = await fetchWithTimeout(url, {
      headers,
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[shopee-listing] HTTP ${res.status} for ${shopId}/${itemId}`);
      return emptyResult("shopee-listing", id);
    }
    body = (await res.json()) as ItemResponse;
  } catch (err) {
    console.error(
      `[shopee-listing] fetch failed for ${shopId}/${itemId}: ${(err as Error).message}`,
    );
    return emptyResult("shopee-listing", id);
  }

  if (body.error || !body.data) {
    console.warn(
      `[shopee-listing] API returned error=${body.error ?? "?"} for ${shopId}/${itemId}`,
    );
    return emptyResult("shopee-listing", id);
  }

  const item = body.data;
  const listingUrl = `https://shopee.ph/product/${shopId}/${itemId}`;
  const source: Source = {
    url: listingUrl,
    title: item.name ?? `Shopee listing ${itemId}`,
    signal_type: "price_sanity",
  };

  const price = scalePrice(item.price ?? item.price_min);
  const ageDays = item.ctime
    ? Math.floor((Date.now() / 1000 - item.ctime) / 86_400)
    : null;
  const rating = item.item_rating?.rating_star;
  const reviewCount = item.cmt_count ?? null;
  const sold = item.historical_sold ?? null;
  const views = item.view_count ?? null;

  const signals: Signal[] = [
    {
      type: "price_sanity",
      weight: 0,
      detail: formatBaseline(item, price, ageDays, rating, reviewCount, sold),
      source,
    },
  ];

  // Listing rating below 4.0 is unusual on Shopee where most listings cluster high.
  if (typeof rating === "number" && rating > 0 && rating < LOW_ITEM_RATING_THRESHOLD) {
    signals.push({
      type: "review_authenticity",
      weight: 0.6,
      detail: `Listing rating is ${rating.toFixed(2)}/5 across ${reviewCount ?? "?"} reviews — below the ${LOW_ITEM_RATING_THRESHOLD}/5 threshold typical for established Shopee listings.`,
      source: { ...source, signal_type: "review_authenticity" },
    });
  }

  // Listing created very recently → less time for fraud to surface in reviews.
  if (ageDays !== null && ageDays < VERY_NEW_LISTING_DAYS) {
    signals.push({
      type: "price_sanity",
      weight: 0.5,
      detail: `Listing was posted only ${ageDays} days ago.`,
      source,
    });
  }

  // High views, ~zero sold = the classic "bait listing" pattern.
  if (
    typeof views === "number" &&
    typeof sold === "number" &&
    views > 1000 &&
    sold === 0
  ) {
    signals.push({
      type: "price_sanity",
      weight: 0.7,
      detail: `Listing has ${views} views but 0 reported sales — unusual ratio for a real product.`,
      source,
    });
  } else if (
    typeof views === "number" &&
    typeof sold === "number" &&
    sold > 0 &&
    views / sold > HIGH_VIEW_LOW_SOLD_RATIO &&
    views > 500
  ) {
    signals.push({
      type: "price_sanity",
      weight: 0.4,
      detail: `Listing views (${views}) far exceed sales (${sold}) — buyers viewing but not converting.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[shopee-listing] lookup done: ${shopId}/${itemId} price=${price ?? "?"} rating=${rating ?? "?"} reviews=${reviewCount ?? "?"} sold=${sold ?? "?"} ageDays=${ageDays ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "shopee-listing",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

function scalePrice(raw: number | undefined): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw / PRICE_SCALE;
}

function formatBaseline(
  item: ItemData,
  price: number | null,
  ageDays: number | null,
  rating: number | undefined,
  reviewCount: number | null,
  sold: number | null,
): string {
  const parts = [`Shopee listing "${item.name ?? "(no name)"}"`];
  if (price !== null) parts.push(`price ₱${price.toFixed(2)}`);
  if (typeof rating === "number") parts.push(`rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount} reviews`);
  if (sold !== null) parts.push(`${sold} sold`);
  if (ageDays !== null) parts.push(`posted ${ageDays} days ago`);
  return parts.join(", ");
}
