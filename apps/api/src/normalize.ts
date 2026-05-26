import { getDomain } from "tldts";
import type { Marketplace, NormalizedInput } from "@sus/shared";

// PRD §3.1 input normalization. Takes a raw URL and returns the marketplace
// context needed for marketplace-aware scrapers (Shopee, Lazada, TikTok, etc.)
// to fetch the right seller/product pages.
//
// URL parsing is synchronous + deterministic. The actual fetch of seller/product
// pages happens later in the marketplace-specific scrapers, so this step stays
// fast (no HTTP calls) and the fan-out budget isn't consumed before it starts.

export function normalizeInput(rawUrl: string): NormalizedInput | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const domain = getDomain(withScheme, { validHosts: ["localhost"] });
  if (!domain) return null;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  // Try each marketplace parser in order. Falls through to the generic
  // null-marketplace result when no pattern matches.
  return (
    parseShopeePh(parsed, domain) ??
    parseLazadaPh(parsed, domain) ??
    parseTiktokShop(parsed, domain) ??
    genericFallback(withScheme, domain)
  );
}

// Shopee PH product URLs have a stable pattern with shop_id and item_id encoded
// as trailing numeric segments separated by ".":
//   https://shopee.ph/<product-name-slug>-i.<shop_id>.<item_id>
//   https://shopee.ph/product/<shop_id>/<item_id>   (older / API-style)
// Shop pages:
//   https://shopee.ph/<seller_username>             (vanity)
//   https://shopee.ph/shop/<shop_id>                (canonical)
function parseShopeePh(url: URL, domain: string): NormalizedInput | null {
  if (domain !== "shopee.ph") return null;

  const path = url.pathname;

  // Product listing: /...-i.<shop_id>.<item_id>
  const listingMatch = path.match(/-i\.(\d+)\.(\d+)\/?$/i);
  if (listingMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: listingMatch[1],
      item_id: listingMatch[2],
    };
  }

  // Product listing (older form): /product/<shop_id>/<item_id>
  const altListing = path.match(/^\/product\/(\d+)\/(\d+)\/?$/i);
  if (altListing) {
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: altListing[1],
      item_id: altListing[2],
    };
  }

  // Shop page (canonical numeric): /shop/<shop_id>
  const shopMatch = path.match(/^\/shop\/(\d+)\/?$/i);
  if (shopMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: shopMatch[1],
      item_id: null,
    };
  }

  // Marketplace URL but unknown sub-path — treat as Shopee with no shop_id.
  // Synthesis can still note this is a Shopee URL.
  return {
    url: url.toString(),
    domain,
    marketplace: "shopee-ph",
    shop_id: null,
    item_id: null,
  };
}

// Lazada PH URL patterns:
//   Product listing:  https://www.lazada.com.ph/products/<slug>-i<item_id>-s<sku>.html?spm=...
//                     https://www.lazada.com.ph/products/<slug>-i<item_id>.html
//   Shop:             https://www.lazada.com.ph/shop/<seller_url_slug>/
//                     https://www.lazada.com.ph/shop/<seller_slug>?sellerId=<seller_id>
// shop_id usually isn't in the URL — it's resolved by the product-page scraper
// after fetching the page (the page embeds sellerId in its runParams JSON).
function parseLazadaPh(url: URL, domain: string): NormalizedInput | null {
  if (domain !== "lazada.com.ph") return null;

  // Product listing: tail of the path is "-i<item_id>" optionally followed by "-s<sku>"
  const productMatch = url.pathname.match(/-i(\d+)(?:-s\d+)?\.html$/i);
  if (productMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "lazada-ph",
      shop_id: null,            // resolved during product-page fetch
      item_id: productMatch[1],
    };
  }

  // Shop page with explicit sellerId query param
  const sellerIdParam = url.searchParams.get("sellerId");
  if (sellerIdParam && /^\d+$/.test(sellerIdParam)) {
    return {
      url: url.toString(),
      domain,
      marketplace: "lazada-ph",
      shop_id: sellerIdParam,
      item_id: null,
    };
  }

  // Generic Lazada page — mark as Lazada but no specific seller/item.
  return {
    url: url.toString(),
    domain,
    marketplace: "lazada-ph",
    shop_id: null,
    item_id: null,
  };
}

// TikTok Shop stub.
function parseTiktokShop(url: URL, domain: string): NormalizedInput | null {
  if (domain !== "tiktok.com" && domain !== "shop.tiktok.com") return null;

  // /@username path
  const userMatch = url.pathname.match(/^\/@([^\/]+)/);
  return {
    url: url.toString(),
    domain,
    marketplace: "tiktok-shop",
    shop_id: userMatch ? userMatch[1] : null,
    item_id: null,
  };
}

function genericFallback(url: string, domain: string): NormalizedInput {
  return {
    url,
    domain,
    marketplace: null,
    shop_id: null,
    item_id: null,
  };
}
