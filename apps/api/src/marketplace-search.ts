import { env } from "./env";
import type { ScreenshotMarketplace } from "./ocr";

// Google Custom Search JSON API wrapper. Given a product title extracted from
// OCR and the marketplace we identified from the screenshot's UI chrome, we
// site-filter the search so the top result is (hopefully) the canonical
// product URL on that marketplace.
//
// Setup (one-time, ~10 min):
//   1. Create a Google Cloud project at https://console.cloud.google.com
//   2. Enable "Custom Search API" in the API Library
//   3. Create an API key under APIs & Services → Credentials → set
//      GOOGLE_CSE_API_KEY in Railway
//   4. Create a Programmable Search Engine at https://programmablesearchengine.google.com
//      • Set "Sites to search" = "Search the entire web"
//      • Copy the "Search engine ID" → set GOOGLE_CSE_ID in Railway
//
// Quota: free tier is 100 queries/day. Paid is $5 per 1000 after that. At
// the PRD §7 success-target scale (10K users) we'd burn this fast — but
// most image scans WILL contain a URL (Shopee/Lazada share with the URL bar
// visible), so this bridge only fires on the in-app TikTok Shop screenshot
// case. Real failure rate is probably <10% of image scans.
//
// Why Google CSE and not a marketplace-native search API:
//   - TikTok Shop has no public search API; the in-app search needs an auth
//     token the API doesn't have
//   - Shopee/Lazada search endpoints exist but are rate-limited, change
//     shape, and have anti-bot protections
//   - Google indexes all three with stable URL formats, so a single
//     site-filtered query reliably returns the canonical product page

const SITE_FILTER: Record<ScreenshotMarketplace, string> = {
  "tiktok-shop": "tiktok.com/shop OR shop.tiktok.com OR shop-XX.tiktok.com",
  shopee: "shopee.ph OR shopee.com.ph",
  lazada: "lazada.com.ph",
};

interface GoogleCseResponse {
  items?: Array<{
    link?: string;
    title?: string;
    snippet?: string;
  }>;
  error?: {
    code?: number;
    message?: string;
  };
}

export interface MarketplaceSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export async function searchMarketplaceProduct(
  marketplace: ScreenshotMarketplace,
  productTitle: string,
): Promise<MarketplaceSearchResult | null> {
  if (!env.GOOGLE_CSE_API_KEY || !env.GOOGLE_CSE_ID) {
    // Bridge is opt-in via env. Without credentials, /scan/image falls back
    // to the existing "Not Enough Info with marketplace-specific hint" path
    // we shipped in Path 1 — graceful degrade, not an error.
    console.log("[marketplace-search] GOOGLE_CSE credentials not set — skipping bridge");
    return null;
  }

  const trimmedTitle = productTitle.trim();
  if (trimmedTitle.length < 8) {
    return null;
  }

  // Wrap the title in quotes to bias toward exact-phrase match. Marketplace
  // titles are long enough that an exact-phrase match in Google's index is
  // usually a 1:1 hit on the canonical product page.
  const siteFilter = SITE_FILTER[marketplace];
  const query = `site:(${siteFilter}) "${trimmedTitle}"`;

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", env.GOOGLE_CSE_API_KEY);
  url.searchParams.set("cx", env.GOOGLE_CSE_ID);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "3");
  url.searchParams.set("safe", "active");

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      console.error(`[marketplace-search] CSE returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as GoogleCseResponse;
    if (data.error) {
      console.error(`[marketplace-search] CSE error: ${data.error.message}`);
      return null;
    }

    const top = data.items?.find((item) => isCanonicalProductLink(marketplace, item.link));
    if (!top || !top.link) {
      // Fallback: if no item matches the canonical URL shape, take the first
      // result anyway. The normalizer will validate it and reject if it's
      // not a real product URL (e.g. a search results page).
      const first = data.items?.[0];
      if (!first?.link) return null;
      return {
        url: first.link,
        title: first.title ?? "",
        snippet: first.snippet ?? "",
      };
    }

    return {
      url: top.link,
      title: top.title ?? "",
      snippet: top.snippet ?? "",
    };
  } catch (err) {
    console.error(`[marketplace-search] fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// Heuristic for "this URL is a real product page, not a category/search
// results/seller-profile page". Each marketplace has a recognizable
// product-URL shape we already handle in normalize.ts — bias toward those.
function isCanonicalProductLink(
  marketplace: ScreenshotMarketplace,
  link: string | undefined,
): boolean {
  if (!link) return false;
  switch (marketplace) {
    case "tiktok-shop":
      // Either the new shop subdomain (shop-XX.tiktok.com/view/product/<id>)
      // or the older path-based form (tiktok.com/shop/product/<id>).
      return /shop-[a-z]{2,3}\.tiktok\.com\/view\/product\/\d+/i.test(link) ||
        /tiktok\.com\/shop\/(?:view\/)?product\/\d+/i.test(link);
    case "shopee":
      // Shopee product URLs end with /i.<shopid>.<itemid> or use the
      // /product/<shopid>/<itemid> shape.
      return /shopee\.(?:com\.)?ph\/.+(?:\.i\.\d+\.\d+|\/product\/\d+\/\d+)/i.test(link);
    case "lazada":
      // Lazada product URLs follow /products/<slug>-i<itemid>-s<skuid>.html
      return /lazada\.com\.ph\/products\/.+-i\d+/i.test(link);
  }
}
