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

// Used for the Shopee item API — that endpoint expects a normal browser UA
// + Referer + X-API-SOURCE to mimic the real PC web app's requests.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Used for the generic og:image scrape. Marketplaces (Shopee in particular)
// recognize known social-card crawlers and serve them a fully-rendered SSR
// variant with og:image present — it's how iMessage / Slack / FB link previews
// work without doing JS rendering. With a generic Chrome UA Shopee returns a
// JS-only shell; with this UA they return the rich crawler variant.
const CRAWLER_UA = "facebookexternalhit/1.1";

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

  // TikTok serves the TikTok Shop brand mark as og:image to bots — a 200x200
  // black square with white "TikTok Shop" text. Bypass the generic scraper
  // for TikTok URLs and try to pull the actual product image out of the
  // inline JSON state blob the page embeds for hydration.
  if (normalized?.marketplace === "tiktok-shop") {
    const fromTiktok = await fetchTiktokThumbnail(url);
    if (fromTiktok) return fromTiktok;
    // No good product image found — return null instead of falling through
    // to scrapeOgImage, because we know that path returns the brand mark.
    // Mobile then degrades to favicon → letter tile, which is uglier but at
    // least doesn't lie about what the user is looking at.
    return null;
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
        "User-Agent": BROWSER_UA,
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
        "User-Agent": CRAWLER_UA,
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

    // Read chunks until we see </body> or hit MAX_BYTES. og:image always lives
    // in <head> but Product JSON-LD sometimes lives in <body> just below the
    // fold, so we read past </head> to catch both. The 512KB cap bounds us
    // even on cooperative-but-huge pages.
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
      if (/<\/body>/i.test(assembled)) break;
    }
    reader.cancel().catch(() => {});

    // Prefer JSON-LD Product.image — that's the clean product shot the seller
    // uploaded. og:image is often a social-card composite with price/rating
    // overlay (especially on Shopee). Fall back to og:image only when JSON-LD
    // is missing or the product image field isn't there.
    const jsonLdImage = extractJsonLdProductImage(assembled);
    if (jsonLdImage) {
      try {
        const absolute = new URL(jsonLdImage, res.url || url).toString();
        console.log(`[thumbnail] ${url} → ${absolute} (json-ld)`);
        return absolute;
      } catch {
        // malformed URL inside JSON-LD — drop through to og:image
      }
    }

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

// Pulls the first Product.image out of any <script type="application/ld+json">
// block on the page. Shopee, Lazada, and most schema.org-compliant marketplaces
// embed this — and the image field there is the clean product photo, NOT the
// social-card composite that ends up in og:image. Returns the URL string, or
// null if no Product JSON-LD block exists / parses.
function extractJsonLdProductImage(html: string): string | null {
  const blockRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const payload = m[1].trim();
    if (!payload) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // malformed block — skip, try the next one
    }
    // Schema.org allows a single object, an array of objects, or @graph nesting.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : isObject(parsed) && Array.isArray((parsed as Record<string, unknown>)["@graph"])
        ? ((parsed as Record<string, unknown>)["@graph"] as unknown[])
        : [parsed];

    for (const node of candidates) {
      if (!isObject(node)) continue;
      const type = (node as Record<string, unknown>)["@type"];
      const isProduct =
        type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;
      const image = (node as Record<string, unknown>).image;
      if (typeof image === "string" && image) return image;
      if (Array.isArray(image)) {
        // Array entries can be strings OR ImageObject {url: "..."}.
        for (const entry of image) {
          if (typeof entry === "string" && entry) return entry;
          if (isObject(entry)) {
            const url = (entry as Record<string, unknown>).url;
            if (typeof url === "string" && url) return url;
          }
        }
      }
      if (isObject(image)) {
        const url = (image as Record<string, unknown>).url;
        if (typeof url === "string" && url) return url;
      }
    }
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// TikTok-specific thumbnail extractor.
//
// TikTok Shop product pages embed a JSON state blob at:
//   <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
// Inside that blob lives the product's image list — usually under a key like
// `images` or `product_images` on a product node. We don't know the exact path
// (TikTok rearranges this every couple of months), so we walk the tree
// looking for the first URL that looks like a TikTok CDN product image:
// hosts ending in `.tiktokcdn.com` / `.tiktokcdn-us.com`, NOT brand-asset
// paths like `/static/` or filenames containing `logo`.
//
// On failure, returns null and lets the caller fall back to favicon. We
// deliberately do NOT fall back to og:image — TikTok's og:image is the
// brand mark and is worse than showing the favicon.
async function fetchTiktokThumbnail(url: string): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      console.log(`[thumbnail] tiktok ${url} → HTTP ${res.status}`);
      return null;
    }

    // Read up to MAX_BYTES. The universal blob sits inside <body> so we have
    // to read past <head>; the cap stops us on pathologically large pages.
    const reader = res.body?.getReader();
    if (!reader) return null;
    let total = 0;
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let assembled = "";
    while (total < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      assembled += decoder.decode(value, { stream: true });
      // Stop early once we've captured both the start of the universal blob
      // AND a closing </script> tag — that means the blob is in `assembled`
      // and further reading is wasted bytes.
      const blobStart = assembled.indexOf("__UNIVERSAL_DATA_FOR_REHYDRATION__");
      if (blobStart !== -1 && assembled.indexOf("</script>", blobStart) !== -1) {
        break;
      }
    }
    reader.cancel().catch(() => {});

    const fromBlob = extractTiktokProductImage(assembled);
    if (fromBlob) {
      try {
        const absolute = new URL(fromBlob, res.url || url).toString();
        console.log(`[thumbnail] tiktok ${url} → ${absolute} (universal-blob)`);
        return absolute;
      } catch {
        return null;
      }
    }

    console.log(`[thumbnail] tiktok ${url} → no product image in blob`);
    return null;
  } catch (err) {
    const msg = (err as Error).message;
    if ((err as Error).name === "AbortError") {
      console.log(`[thumbnail] tiktok ${url} → timeout (${TIMEOUT_MS}ms)`);
    } else {
      console.log(`[thumbnail] tiktok ${url} → fetch error: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Walks the universal-data blob looking for the first URL that smells like a
// TikTok product CDN image. Conservative: skips brand-asset paths.
function extractTiktokProductImage(html: string): string | null {
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

  const candidates: string[] = [];
  collectImageUrls(parsed, candidates, 0);
  // First product-CDN URL wins. We prefer the cleanest-looking candidate.
  for (const candidate of candidates) {
    if (isTiktokProductImage(candidate)) return candidate;
  }
  return null;
}

function collectImageUrls(node: unknown, out: string[], depth: number): void {
  if (depth > 12 || out.length > 50) return;
  if (typeof node === "string") {
    if (/^https?:\/\/[^"'\s]+\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(node) || /tiktokcdn(?:-us)?\.com\//i.test(node)) {
      out.push(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectImageUrls(item, out, depth + 1);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectImageUrls(value, out, depth + 1);
    }
  }
}

function isTiktokProductImage(candidate: string): boolean {
  const lowered = candidate.toLowerCase();
  // TikTok CDN-hosted images.
  if (!/tiktokcdn(?:-us)?\.com\//.test(lowered)) return false;
  // Brand assets and platform UI graphics live under /static/, /obj/, with
  // identifiers like "tiktokshop_logo", "default_avatar", or with /ies/ paths
  // that indicate platform icons rather than seller-uploaded product photos.
  if (lowered.includes("logo")) return false;
  if (lowered.includes("default_avatar")) return false;
  if (lowered.includes("/static/")) return false;
  if (lowered.includes("placeholder")) return false;
  return true;
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
