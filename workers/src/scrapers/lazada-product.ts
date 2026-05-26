import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getLazadaHeaders } from "./_lazada-auth";

// Lazada PH product-page scraper. Unlike Shopee, Lazada doesn't expose a
// reliable public JSON API for product details — instead it embeds the product
// + seller data inside the HTML page as a JS blob assigned to window.runParams
// (or, on newer pages, a JSON-LD <script> block).
//
// We fetch the page HTML once and extract:
//   • Product: name, price, rating, review count, sold count
//   • Seller: name, rating, days since opened, follower count, "LazMall" / "Verified" badges
//
// One scraper covers both because Lazada delivers them in the same payload.

const TIMEOUT_MS = 12_000;

// Same calibration philosophy as Shopee — PH marketplace ratings cluster high.
const LOW_ITEM_RATING_THRESHOLD = 4.0;
const LOW_SHOP_RATING_THRESHOLD = 4.0;
const VERY_NEW_SHOP_DAYS = 90;
const VERY_NEW_LISTING_DAYS = 30;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface LazadaRunParams {
  // Top-level shape varies by page version. We probe these keys defensively.
  data?: {
    root?: {
      fields?: LazadaFields;
    };
  };
  // Older layout
  fields?: LazadaFields;
}

interface LazadaFields {
  product?: {
    title?: string;
    rating?: { average?: number | string; totalRatings?: number | string };
    sellerName?: string;
    sellerId?: string | number;
  };
  skuBase?: {
    skus?: Array<{ price?: number | string; specialPrice?: number | string }>;
  };
  seller?: {
    name?: string;
    sellerId?: string | number;
    rating?: number | string;
    positiveRating?: string;
    daysOpened?: number | string;
    fans?: number | string;
    followers?: number | string;
    isOfficial?: boolean;
    isLazMall?: boolean;
    isVerified?: boolean;
    location?: string;
    storePoint?: {
      ratingScore?: number | string;
    };
  };
  reviewRatings?: {
    rating?: number | string;
    averageRating?: number | string;
    totalRatings?: number | string;
  };
  itemSold?: number | string;
}

export async function lazadaProductScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "lazada-ph" || !data.item_id) {
    return emptyResult("lazada-product", id);
  }

  // Reconstruct the canonical product URL from the original target_url; if
  // anything went sideways (truncated URL, missing slug), fall back to the
  // bare-item-id form that Lazada accepts.
  const pageUrl = data.target_url || `https://www.lazada.com.ph/products/-i${data.item_id}.html`;
  console.log(`[lazada-product] lookup start: itemId=${data.item_id}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: getLazadaHeaders("https://www.lazada.com.ph/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[lazada-product] HTTP ${res.status} for ${pageUrl}`);
      return emptyResult("lazada-product", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(
      `[lazada-product] fetch failed for ${pageUrl}: ${(err as Error).message}`,
    );
    return emptyResult("lazada-product", id);
  }

  const params = extractRunParams(html);
  if (!params) {
    console.warn(`[lazada-product] could not parse runParams for itemId=${data.item_id}`);
    return emptyResult("lazada-product", id);
  }

  const fields = params.data?.root?.fields ?? params.fields ?? {};

  const productTitle = fields.product?.title;
  const itemRating = toNumber(fields.reviewRatings?.averageRating ?? fields.reviewRatings?.rating);
  const reviewCount = toNumber(fields.reviewRatings?.totalRatings);
  const sold = toNumber(fields.itemSold);
  const price = parsePrice(fields.skuBase?.skus?.[0]?.specialPrice ?? fields.skuBase?.skus?.[0]?.price);

  const seller = fields.seller ?? {};
  const sellerName = seller.name ?? fields.product?.sellerName;
  const sellerId = String(seller.sellerId ?? fields.product?.sellerId ?? "");
  const sellerRating = toNumber(seller.storePoint?.ratingScore ?? seller.rating);
  const sellerFollowers = toNumber(seller.fans ?? seller.followers);
  const sellerDaysOpened = toNumber(seller.daysOpened);
  const isLazMall = seller.isLazMall === true;
  const isOfficial = seller.isOfficial === true;
  const isVerified = seller.isVerified === true;

  const sellerSource: Source = {
    url: sellerId
      ? `https://www.lazada.com.ph/shop/${encodeURIComponent(sellerName ?? sellerId)}?sellerId=${sellerId}`
      : pageUrl,
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
      detail: formatSellerBaseline(sellerName, sellerId, sellerRating, sellerFollowers, sellerDaysOpened, {
        isLazMall,
        isOfficial,
        isVerified,
      }),
      source: sellerSource,
    },
    {
      type: "price_sanity",
      weight: 0,
      detail: formatListingBaseline(productTitle, price, itemRating, reviewCount, sold),
      source: listingSource,
    },
  ];

  // Positive seller signals — Lazada badges are PH-meaningful, same as Shopee.
  if (isLazMall) {
    signals.push({
      type: "seller_reputation",
      weight: -0.9,
      detail: `Seller is verified as LazMall (Lazada's brand/official storefront tier).`,
      source: sellerSource,
    });
  }
  if (isOfficial) {
    signals.push({
      type: "seller_reputation",
      weight: -0.8,
      detail: `Seller is verified as an Official Store on Lazada.`,
      source: sellerSource,
    });
  }
  if (isVerified && !isLazMall && !isOfficial) {
    signals.push({
      type: "seller_reputation",
      weight: -0.4,
      detail: `Seller has Lazada's "Verified" badge.`,
      source: sellerSource,
    });
  }

  // Negative seller signals.
  if (sellerRating !== null && sellerRating > 0 && sellerRating < LOW_SHOP_RATING_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.7,
      detail: `Seller's average rating is ${sellerRating.toFixed(2)}/5 — below the ${LOW_SHOP_RATING_THRESHOLD}/5 threshold typical for established Lazada sellers.`,
      source: sellerSource,
    });
  }
  if (sellerDaysOpened !== null && sellerDaysOpened < VERY_NEW_SHOP_DAYS) {
    signals.push({
      type: "seller_reputation",
      weight: 0.6,
      detail: `Seller's shop has been open only ${sellerDaysOpened} days — newly registered sellers carry higher risk.`,
      source: sellerSource,
    });
  }

  // Listing-level negatives.
  if (itemRating !== null && itemRating > 0 && itemRating < LOW_ITEM_RATING_THRESHOLD) {
    signals.push({
      type: "review_authenticity",
      weight: 0.5,
      detail: `Listing rating is ${itemRating.toFixed(2)}/5 across ${reviewCount ?? "?"} reviews — below the ${LOW_ITEM_RATING_THRESHOLD}/5 threshold typical for established Lazada listings.`,
      source: { ...listingSource, signal_type: "review_authenticity" },
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[lazada-product] lookup done: itemId=${data.item_id} seller="${sellerName ?? "?"}" sellerRating=${sellerRating ?? "?"} sellerDays=${sellerDaysOpened ?? "?"} listing="${productTitle ?? "?"}" price=${price ?? "?"} rating=${itemRating ?? "?"} reviews=${reviewCount ?? "?"} sold=${sold ?? "?"} lazMall=${isLazMall} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "lazada-product",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Lazada injects product state via:
//   window.runParams = { data: { root: { fields: { ... } } } };
// or some pages use the older shape:
//   window.runParams = { mods: { ..., fields: { ... } } };
// Pattern hunts both.
function extractRunParams(html: string): LazadaRunParams | null {
  // Prefer the assignment to window.runParams = {...};
  const assignMatch = html.match(/window\.runParams\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (assignMatch) {
    try {
      return JSON.parse(assignMatch[1]) as LazadaRunParams;
    } catch {
      // fall through to other strategies
    }
  }

  // Some pages use `app.run({ data: ... })`-style boot — try that too.
  const appRunMatch = html.match(/app\.run\(\s*(\{[\s\S]*?\})\s*\);/);
  if (appRunMatch) {
    try {
      return JSON.parse(appRunMatch[1]) as LazadaRunParams;
    } catch {
      // fall through
    }
  }

  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Strip non-numeric prefix/suffix (e.g. "4.7 / 5" → 4.7)
    const m = v.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parsePrice(v: unknown): number | null {
  return toNumber(v);
}

function formatSellerBaseline(
  name: string | undefined,
  id: string,
  rating: number | null,
  followers: number | null,
  daysOpened: number | null,
  badges: { isLazMall: boolean; isOfficial: boolean; isVerified: boolean },
): string {
  const parts = [`Lazada seller ${name ? `"${name}"` : id || "(unknown)"}`];
  if (rating !== null) parts.push(`rating ${rating.toFixed(2)}/5`);
  if (followers !== null) parts.push(`${followers} followers`);
  if (daysOpened !== null) parts.push(`${daysOpened} days open`);
  if (badges.isLazMall) parts.push("LazMall");
  else if (badges.isOfficial) parts.push("Official Store");
  else if (badges.isVerified) parts.push("Verified");
  return parts.join(", ");
}

function formatListingBaseline(
  title: string | undefined,
  price: number | null,
  rating: number | null,
  reviewCount: number | null,
  sold: number | null,
): string {
  const parts = [`Lazada listing ${title ? `"${title}"` : "(no title)"}`];
  if (price !== null) parts.push(`price ₱${price.toFixed(2)}`);
  if (rating !== null) parts.push(`rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount} reviews`);
  if (sold !== null) parts.push(`${sold} sold`);
  return parts.join(", ");
}
