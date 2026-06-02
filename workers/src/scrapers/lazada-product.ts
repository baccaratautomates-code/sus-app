import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getLazadaHeaders } from "./_lazada-auth";

// Lazada PH product-page scraper.
//
// HISTORY: Lazada used to embed all product + seller + review data inside the
// HTML page as `window.runParams = {...}`. As of mid-2026 that's gone — the
// product page is now a client-rendered shell. The static HTML only carries:
//   • A `__moduleData__` blob (product title, brand, sellerId, sku/price)
//   • JSON-LD <script> blocks (product name, brand, brand-store URL)
// The rating, review count, and review distribution are NOT in the page source
// anymore; the browser fetches them from a separate review API after load.
//
// So we now do TWO things:
//   1. Fetch the product page → parse JSON-LD for brand / brand-store signal,
//      and harvest anti-bot cookies (hng, EGG_SESS) for the next call.
//   2. Call the public review API (my.lazada.com.ph/pdp/review/getReviewList)
//      WITH those cookies → average rating, review count, score histogram.
//
// The review API is anti-bot guarded: the FIRST call per fresh cookie session
// succeeds, rapid repeats get a "_____tmd_____/punish" captcha page. Since a
// scan makes exactly one call, the first-call-succeeds behaviour is enough —
// we detect the punish page and degrade gracefully (no rating signals) rather
// than 500ing or polluting the verdict with garbage.

// Tighter than the old single 12s budget: this scraper now makes two sequential
// fetches, and the whole scan fan-out has a 25s ceiling.
const PAGE_TIMEOUT_MS = 8_000;
const REVIEW_TIMEOUT_MS = 6_000;

// Same calibration philosophy as Shopee — PH marketplace ratings cluster high.
const LOW_ITEM_RATING_THRESHOLD = 4.0;
const HIGH_RATING_THRESHOLD = 4.5;
const ESTABLISHED_REVIEW_COUNT = 100;
const SPARSE_REVIEW_COUNT = 10;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

// Shape of the my.lazada.com.ph/pdp/review/getReviewList response (the subset
// we read). Probed defensively — Lazada changes these without notice.
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
      // 5★ → 1★ counts, e.g. [793, 17, 4, 1, 2]
      scores?: number[];
    };
  };
}

interface JsonLdProduct {
  title: string | null;
  brand: string | null;
  isBrandStore: boolean;
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

  // --- Step 1: fetch the product page (brand/JSON-LD + warmup cookies) ---
  let jsonLd: JsonLdProduct = { title: null, brand: null, isBrandStore: false };
  let cookie = "";
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: getLazadaHeaders("https://www.lazada.com.ph/"),
      timeoutMs: PAGE_TIMEOUT_MS,
    });
    if (res.ok) {
      cookie = collectCookies(res);
      jsonLd = extractJsonLdProduct(await res.text());
    } else {
      console.warn(`[lazada-product] page HTTP ${res.status} for ${pageUrl}`);
    }
  } catch (err) {
    console.warn(`[lazada-product] page fetch failed for ${pageUrl}: ${(err as Error).message}`);
    // Non-fatal: we can still try the review API without warmup cookies.
  }

  // --- Step 2: call the review API for rating + count + distribution ---
  const review = await fetchReviews(data.item_id, pageUrl, cookie);

  const item = review?.model?.item;
  const ratings = review?.model?.ratings;
  const productTitle = item?.itemTitle ?? jsonLd.title ?? undefined;
  const brand = jsonLd.brand ?? undefined;
  const sellerId = String(item?.sellerId ?? "");
  const sellerName = item?.sellerName ?? brand ?? undefined;
  const price = parsePesoPrice(item?.productPrice);
  const itemRating = toNumber(ratings?.average);
  const reviewCount =
    toNumber(ratings?.reviewCount) ??
    toNumber(ratings?.rateCount) ??
    toNumber(review?.model?.paging?.totalItems);

  // If we got nothing usable from EITHER source, return empty so synthesis
  // honestly reports "Not Enough Info" rather than us inventing a baseline.
  if (!productTitle && itemRating === null && reviewCount === null && !brand) {
    console.warn(
      `[lazada-product] no usable data for itemId=${data.item_id} (review punished/failed and no JSON-LD)`,
    );
    return emptyResult("lazada-product", id);
  }

  const sellerSource: Source = {
    url: sellerId
      ? `https://www.lazada.com.ph/shop/?sellerId=${sellerId}`
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
      detail: formatSellerBaseline(sellerName, sellerId, itemRating, reviewCount, jsonLd.isBrandStore),
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

  // Positive: brand / official store (inferred from the JSON-LD brand link,
  // e.g. brand.url = ".../omron/?type=brand"). Lazada no longer exposes the
  // LazMall flag in the page source, so this is our best public proxy.
  if (jsonLd.isBrandStore && brand) {
    signals.push({
      type: "seller_reputation",
      weight: -0.4,
      detail: `Listing is sold under the official "${brand}" brand store on Lazada.`,
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
    `[lazada-product] lookup done: itemId=${data.item_id} seller="${sellerName ?? "?"}" sellerId=${sellerId || "?"} brand="${brand ?? "?"}" brandStore=${jsonLd.isBrandStore} listing="${productTitle ?? "?"}" price=${price ?? "?"} rating=${itemRating ?? "?"} reviews=${reviewCount ?? "?"} reviewApi=${review ? "ok" : "miss"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "lazada-product",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Calls the review API with the warmup cookies. Returns null on any failure
// (HTTP error, anti-bot punish page, non-JSON body) — the caller degrades to
// brand/JSON-LD-only signals or an empty result.
async function fetchReviews(
  itemId: string,
  pageUrl: string,
  cookie: string,
): Promise<LazadaReviewResponse | null> {
  const reviewUrl = `https://my.lazada.com.ph/pdp/review/getReviewList?itemId=${encodeURIComponent(itemId)}&pageSize=3&filter=0&sort=0`;
  try {
    const headers: Record<string, string> = {
      ...getLazadaHeaders(pageUrl),
      Accept: "application/json, text/plain, */*",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };
    if (cookie) headers.Cookie = cookie;

    const res = await fetchWithTimeout(reviewUrl, { headers, timeoutMs: REVIEW_TIMEOUT_MS });
    if (!res.ok) {
      console.warn(`[lazada-product] review API HTTP ${res.status} for itemId=${itemId}`);
      return null;
    }
    const text = await res.text();
    // Anti-bot interstitial — Lazada serves an HTML captcha page (200 OK) with
    // a "_____tmd_____/punish" redirect instead of JSON when it rate-limits us.
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
    /\"action\"\s*:\s*\"captcha\"/.test(text)
  );
}

// Pulls Set-Cookie name=value pairs off the page response so the review API
// call looks like it came from the same session. Uses getSetCookie() (Node 20+
// / Bun) with a single-header fallback.
function collectCookies(res: Response): string {
  const list =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : ([res.headers.get("set-cookie")].filter(Boolean) as string[]);
  return list.map((c) => c.split(";")[0]).join("; ");
}

// Parses the JSON-LD <script type="application/ld+json"> blocks for the Product
// node. Gives us product title + brand, and whether the brand links to an
// official brand store (brand.url contains "type=brand").
function extractJsonLdProduct(html: string): JsonLdProduct {
  const result: JsonLdProduct = { title: null, brand: null, isBrandStore: false };
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    let node: unknown;
    try {
      node = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const candidates = Array.isArray(node) ? node : [node];
    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;
      const obj = c as Record<string, unknown>;
      if (obj["@type"] !== "Product") continue;
      if (typeof obj.name === "string") result.title = obj.name;
      const brand = obj.brand as Record<string, unknown> | undefined;
      if (brand && typeof brand === "object") {
        if (typeof brand.name === "string" && brand.name.trim()) result.brand = brand.name.trim();
        if (typeof brand.url === "string" && /type=brand/i.test(brand.url)) {
          result.isBrandStore = true;
        }
      }
      return result; // first Product node wins
    }
  }
  return result;
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

// Parses a Lazada price string like "₱10,699.00" → 10699. Strips the currency
// symbol and thousands separators.
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
  isBrandStore: boolean,
): string {
  const parts = [`Lazada seller ${name ? `"${name}"` : id || "(unknown)"}`];
  if (rating !== null) parts.push(`listing rating ${rating.toFixed(2)}/5`);
  if (reviewCount !== null) parts.push(`${reviewCount.toLocaleString()} reviews`);
  if (isBrandStore) parts.push("official brand store");
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
