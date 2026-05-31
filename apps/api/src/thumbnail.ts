// Product thumbnail resolver for History row UI.
//
// Why this exists: every Shopee listing has the same orange-bag favicon, so a
// favicon-only row list is unreadable when you've scanned 5 Shopee products.
// We want the actual product photo (the same image iMessage / Slack / Discord
// show in link previews).
//
// Two paths, in priority order:
//   1. Marketplace-specific API (Shopee). Shopee is a JS-rendered SPA — their
//      crawler-facing HTML either 403s server-side fetches or returns the
//      generic orange-bag brand image as og:image. We bypass that by hitting
//      the same JSON endpoint their own web app calls, using the shop_id +
//      item_id we already parsed in normalize.ts.
//   2. Generic og:image / twitter:image scrape from the page HTML. Works for
//      Lazada (they serve crawler-friendly meta), Facebook Marketplace, and
//      most non-SPA sites.
//
// Both paths swallow every error and return null; the mobile client's
// ScanThumbnail falls back to favicon → letter tile.

import type { NormalizedInput } from "@sus/shared";

// Tight timeout because thumbnail fetch sits on the critical path for cache
// hits (cache hit response time = cache lookup + thumbnail fetch + persist).
// 2.5s catches slow-but-available CDN responses without making cache hits feel
// slow. Cache misses parallelize this with the 25s scraper fan-out, so the
// timeout effectively only bounds the cache-hit case.
const TIMEOUT_MS = 2_500;

// Cap how much HTML we read. og:image lives in <head>, which is always within
// the first ~50KB of any real page. 512KB is generous — if the page is bigger
// than that with no <head>, something is wrong and we'd rather bail than buffer.
const MAX_BYTES = 512 * 1024;

// Real-browser UA. Some marketplaces (Shopee in particular) return a stripped
// HTML page or a 403 to non-browser User-Agents. The cost of pretending to be
// Chrome here is zero; the cost of being honest is a missing thumbnail.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Try the best-quality preview meta tag, then fall back to Twitter's variant.
// Some sites only set one. Order matters: og:image is the iMessage/Slack standard.
const META_NAMES = ["og:image:secure_url", "og:image:url", "og:image", "twitter:image"] as const;

export async function fetchThumbnail(
  url: string,
  normalized?: NormalizedInput | null,
): Promise<string | null> {
  // Marketplace-specific paths first. Shopee's HTML is unreadable from a
  // server fetch (SPA + bot block), so we go straight to their JSON API.
  if (
    normalized?.marketplace === "shopee-ph" &&
    normalized.shop_id &&
    normalized.item_id
  ) {
    const fromApi = await fetchShopeeThumbnail(
      normalized.shop_id,
      normalized.item_id,
    );
    if (fromApi) return fromApi;
    // Fall through to og:image scrape only if the API call failed entirely —
    // a successful API call that returned a brand-banner image is still
    // better than scraping the SPA shell for the same banner.
  }

  return scrapeOgImage(url);
}

// Calls Shopee's public item endpoint — the same one their own web app uses
// to populate the product page. Returns the CDN URL of the primary image.
//
// Headers matter: without X-API-SOURCE + Referer, Shopee returns 403 to
// server-side callers. The Chrome UA alone isn't enough.
async function fetchShopeeThumbnail(
  shopId: string,
  itemId: string,
): Promise<string | null> {
  const apiUrl = `https://shopee.ph/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "X-API-SOURCE": "pc",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://shopee.ph/product/${shopId}/${itemId}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.log(
        `[thumbnail] shopee API ${shopId}/${itemId} → HTTP ${res.status}`,
      );
      return null;
    }
    const json = (await res.json()) as {
      data?: { image?: string; images?: string[] };
    };
    const hash = json.data?.image ?? json.data?.images?.[0];
    if (!hash) {
      console.log(
        `[thumbnail] shopee API ${shopId}/${itemId} → no image hash`,
      );
      return null;
    }
    // Shopee's PH CDN. The hash IS the filename; no extension needed.
    const cdnUrl = `https://down-ph.img.susercontent.com/file/${hash}`;
    console.log(`[thumbnail] shopee API ${shopId}/${itemId} → ${cdnUrl}`);
    return cdnUrl;
  } catch (err) {
    const msg = (err as Error).message;
    if ((err as Error).name === "AbortError") {
      console.log(
        `[thumbnail] shopee API ${shopId}/${itemId} → timeout (${TIMEOUT_MS}ms)`,
      );
    } else {
      console.log(
        `[thumbnail] shopee API ${shopId}/${itemId} → fetch error: ${msg}`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Generic og:image scraper. Works for Lazada (crawler-friendly), Facebook
// Marketplace, and most non-SPA pages. Used as the fallback when no
// marketplace-specific path applies (or the marketplace path returned null).
async function scrapeOgImage(url: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) {
      console.log(`[thumbnail] ${url} → HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    const reader = res.body?.getReader();
    if (!reader) return null;

    // Read chunks until we see </head> or hit MAX_BYTES. We stop early because
    // og:image is always near the top of the document and reading the rest
    // wastes bandwidth + time.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let assembled = "";
    while (total < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      assembled += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(assembled)) break;
    }
    reader.cancel().catch(() => {});

    const ogImage = extractFirstMeta(assembled, META_NAMES);
    if (!ogImage) {
      console.log(`[thumbnail] ${url} → no og:image meta`);
      return null;
    }

    // og:image is often a relative path. Resolve against the page URL so the
    // mobile client gets an absolute URL it can <Image source={{uri}} /> directly.
    try {
      const absolute = new URL(ogImage, res.url || url).toString();
      console.log(`[thumbnail] ${url} → ${absolute}`);
      return absolute;
    } catch {
      return null;
    }
  } catch (err) {
    const msg = (err as Error).message;
    if ((err as Error).name === "AbortError") {
      console.log(`[thumbnail] ${url} → timeout (${TIMEOUT_MS}ms)`);
    } else {
      console.log(`[thumbnail] ${url} → fetch error: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Tries each meta-name in order and returns the first content value found.
// Accepts both attribute orderings (property-first and content-first) because
// real-world HTML has both — opengraph.dev and Shopee disagree on this.
function extractFirstMeta(
  html: string,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*?content=["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["']${escaped}["']`,
        "i",
      ),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) return m[1].trim();
    }
  }
  return null;
}
