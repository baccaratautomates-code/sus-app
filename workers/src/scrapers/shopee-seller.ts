import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getShopeeHeaders } from "./_shopee-auth";

// Shopee PH seller-profile scraper. Fetches the internal Shop Detail API for the
// shop_id parsed out of the URL and turns its fields into trust signals.
//
// Endpoint (unofficial but stable for years):
//   https://shopee.ph/api/v4/shop/get_shop_detail?shopid=<shop_id>
//
// Shopee returns 403 to anonymous fetch — we warm up cookies via getShopeeHeaders()
// before hitting the API. On non-200 the scraper returns empty.

const API_URL = "https://shopee.ph/api/v4/shop/get_shop_detail";
const TIMEOUT_MS = 10_000;

// Thresholds calibrated for PH marketplace context.
const LOW_RATING_THRESHOLD = 4.0;          // Shopee ratings cluster high; <4.0 is unusual
const VERY_NEW_SHOP_DAYS = 90;
const LOW_FOLLOWER_THRESHOLD = 50;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface ShopDetailData {
  rating_star?: number;            // overall avg star rating (0-5, may be float)
  rating_good?: number;            // count of good ratings
  rating_normal?: number;
  rating_bad?: number;
  follower_count?: number;
  shop_location?: string;
  ctime?: number;                   // creation time, unix seconds
  last_active_time?: number;
  response_rate?: number;           // 0-100
  response_time?: number;           // seconds
  is_preferred?: boolean;
  is_official_shop?: boolean;
  is_mall?: boolean;
  item_count?: number;
  account?: { username?: string };
  name?: string;
}

interface ShopDetailResponse {
  error?: number;
  data?: ShopDetailData;
}

export async function shopeeSellerScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "shopee-ph" || !data.shop_id) {
    // Shouldn't happen — gated by API queue — but defensive.
    return emptyResult("shopee-seller", id);
  }

  const shopId = data.shop_id;
  console.log(`[shopee-seller] lookup start: shopId=${shopId}`);
  const startedAt = Date.now();

  let body: ShopDetailResponse;
  try {
    const url = `${API_URL}?shopid=${encodeURIComponent(shopId)}`;
    const headers = await getShopeeHeaders(`https://shopee.ph/shop/${shopId}`);
    const res = await fetchWithTimeout(url, {
      headers,
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[shopee-seller] HTTP ${res.status} for shopId=${shopId}`);
      return emptyResult("shopee-seller", id);
    }
    body = (await res.json()) as ShopDetailResponse;
  } catch (err) {
    console.error(`[shopee-seller] fetch failed for shopId=${shopId}: ${(err as Error).message}`);
    return emptyResult("shopee-seller", id);
  }

  if (body.error || !body.data) {
    console.warn(`[shopee-seller] API returned error=${body.error ?? "?"} for shopId=${shopId}`);
    return emptyResult("shopee-seller", id);
  }

  const shop = body.data;
  const shopUrl = `https://shopee.ph/shop/${shopId}`;
  const source: Source = {
    url: shopUrl,
    title: shop.name ?? `Shopee shop ${shopId}`,
    signal_type: "seller_reputation",
  };

  const ageDays = shop.ctime
    ? Math.floor((Date.now() / 1000 - shop.ctime) / 86_400)
    : null;

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(shopId, shop, ageDays),
      source,
    },
  ];

  // Positive signals — Shopee badges are PH-meaningful.
  if (shop.is_mall) {
    signals.push({
      type: "seller_reputation",
      weight: -0.8, // negative weight = green flag (subtract from risk)
      detail: `Shop is verified as a Shopee Mall seller (brand/official storefront).`,
      source,
    });
  }
  if (shop.is_preferred) {
    signals.push({
      type: "seller_reputation",
      weight: -0.5,
      detail: `Shop has Shopee's "Preferred Seller" badge.`,
      source,
    });
  }
  if (shop.is_official_shop) {
    signals.push({
      type: "seller_reputation",
      weight: -0.8,
      detail: `Shop is verified as an Official Shop on Shopee.`,
      source,
    });
  }

  // Negative signals.
  if (typeof shop.rating_star === "number" && shop.rating_star < LOW_RATING_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.7,
      detail: `Shop's average rating is ${shop.rating_star.toFixed(2)}/5 — below the ${LOW_RATING_THRESHOLD}/5 threshold typical for established Shopee sellers.`,
      source,
    });
  }

  if (ageDays !== null && ageDays < VERY_NEW_SHOP_DAYS) {
    signals.push({
      type: "seller_reputation",
      weight: 0.6,
      detail: `Shop was created only ${ageDays} days ago — newly registered sellers carry higher risk on Shopee.`,
      source,
    });
  }

  if (
    typeof shop.follower_count === "number" &&
    shop.follower_count < LOW_FOLLOWER_THRESHOLD
  ) {
    signals.push({
      type: "seller_reputation",
      weight: 0.4,
      detail: `Shop has only ${shop.follower_count} followers — limited social proof.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[shopee-seller] lookup done: shopId=${shopId} rating=${shop.rating_star ?? "?"} followers=${shop.follower_count ?? "?"} ageDays=${ageDays ?? "?"} mall=${shop.is_mall ?? false} preferred=${shop.is_preferred ?? false} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "shopee-seller",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

function formatBaseline(shopId: string, shop: ShopDetailData, ageDays: number | null): string {
  const parts = [`Shopee shop ${shopId}`];
  if (shop.name) parts.push(`name "${shop.name}"`);
  if (typeof shop.rating_star === "number") parts.push(`rating ${shop.rating_star.toFixed(2)}/5`);
  if (typeof shop.follower_count === "number") parts.push(`${shop.follower_count} followers`);
  if (ageDays !== null) parts.push(`${ageDays} days old`);
  if (shop.is_mall) parts.push("Shopee Mall");
  else if (shop.is_official_shop) parts.push("Official Shop");
  else if (shop.is_preferred) parts.push("Preferred Seller");
  if (shop.shop_location) parts.push(`location ${shop.shop_location}`);
  return parts.join(", ");
}
