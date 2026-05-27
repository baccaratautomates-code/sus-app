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
    parseTemu(parsed, domain) ??
    parseFacebook(parsed, domain) ??
    parseInstagram(parsed, domain) ??
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

// TikTok / TikTok Shop URL patterns. The marketplace ID is the @username
// (without the "@") — that's how TikTok identifies sellers. Video IDs become
// item_id when present.
//   https://www.tiktok.com/@username
//   https://www.tiktok.com/@username/video/<video_id>
//   https://www.tiktok.com/t/<short_id>             (short share link — opaque)
//   https://shop.tiktok.com/...                     (the actual shop subdomain)
//   https://vt.tiktok.com/<short_id>                (alternative short share)
function parseTiktokShop(url: URL, domain: string): NormalizedInput | null {
  const isTiktokDomain =
    domain === "tiktok.com" ||
    domain === "vt.tiktok.com"; // shortener
  if (!isTiktokDomain) return null;

  // /@username[/video/<id>]
  const usernameVideo = url.pathname.match(/^\/@([^\/]+)(?:\/video\/(\d+))?/);
  if (usernameVideo) {
    return {
      url: url.toString(),
      domain,
      marketplace: "tiktok-shop",
      shop_id: usernameVideo[1],
      item_id: usernameVideo[2] ?? null,
    };
  }

  // Short share / opaque URLs — we know it's TikTok but can't resolve until fetched.
  return {
    url: url.toString(),
    domain,
    marketplace: "tiktok-shop",
    shop_id: null,
    item_id: null,
  };
}

// Temu is effectively single-seller (PDD Holdings sells everything), so we
// only track the listing identifier — there's no shop_id meaningfully separate
// from the platform. URL patterns:
//   https://www.temu.com/<product-slug>-g-<goods_id>.html
//   https://www.temu.com/<region>/<product-slug>-g-<goods_id>.html
//   https://www.temu.com/-g-<goods_id>.html                    (bare)
// Short share links (share.temu.com/...) are opaque and stay null.
function parseTemu(url: URL, domain: string): NormalizedInput | null {
  if (domain !== "temu.com") return null;

  const goodsMatch = url.pathname.match(/-g-(\d+)\.html$/i);
  return {
    url: url.toString(),
    domain,
    marketplace: "temu",
    shop_id: null,
    item_id: goodsMatch ? goodsMatch[1] : null,
  };
}

// Facebook URL patterns (pages, marketplace, ads):
//   https://www.facebook.com/<page_handle>
//   https://www.facebook.com/<numeric_id>
//   https://www.facebook.com/marketplace/item/<item_id>/
//   https://www.facebook.com/marketplace/<location>/item/<item_id>/
//   https://m.facebook.com/...                    (mobile mirror)
//   https://fb.com/...                            (shortener — same content)
//   https://www.facebook.com/profile.php?id=<id>
function parseFacebook(url: URL, domain: string): NormalizedInput | null {
  const isFb =
    domain === "facebook.com" ||
    domain === "fb.com" ||
    domain === "fb.me";
  if (!isFb) return null;

  const path = url.pathname;

  // Marketplace listing
  const marketplaceMatch = path.match(/\/marketplace\/(?:[^\/]+\/)?item\/(\d+)/i);
  if (marketplaceMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "facebook",
      shop_id: null,                // FB marketplace listings rarely expose the seller publicly
      item_id: marketplaceMatch[1],
    };
  }

  // profile.php?id=...
  const profileId = url.searchParams.get("id");
  if (path === "/profile.php" && profileId && /^\d+$/.test(profileId)) {
    return {
      url: url.toString(),
      domain,
      marketplace: "facebook",
      shop_id: profileId,
      item_id: null,
    };
  }

  // Page or numeric id at the root (handle)
  const handleMatch = path.match(/^\/([A-Za-z0-9\.\-_]+)\/?$/);
  if (handleMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "facebook",
      shop_id: handleMatch[1],
      item_id: null,
    };
  }

  return {
    url: url.toString(),
    domain,
    marketplace: "facebook",
    shop_id: null,
    item_id: null,
  };
}

// Instagram URL patterns:
//   https://www.instagram.com/<username>/         (profile)
//   https://www.instagram.com/p/<post_id>/        (feed post)
//   https://www.instagram.com/reel/<reel_id>/
//   https://www.instagram.com/tv/<tv_id>/
function parseInstagram(url: URL, domain: string): NormalizedInput | null {
  if (domain !== "instagram.com") return null;

  const path = url.pathname;

  // /p/<id>/, /reel/<id>/, /tv/<id>/ — post / reel / IGTV
  const postMatch = path.match(/^\/(?:p|reel|tv)\/([^\/]+)/);
  if (postMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "instagram",
      shop_id: null,                // resolved during fetch
      item_id: postMatch[1],
    };
  }

  // /<username>/ — profile (also reachable via /stories/<username>/ etc., catch the simple case)
  const profileMatch = path.match(/^\/([A-Za-z0-9_\.]+)\/?$/);
  if (profileMatch && profileMatch[1].toLowerCase() !== "explore") {
    return {
      url: url.toString(),
      domain,
      marketplace: "instagram",
      shop_id: profileMatch[1],
      item_id: null,
    };
  }

  return {
    url: url.toString(),
    domain,
    marketplace: "instagram",
    shop_id: null,
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
