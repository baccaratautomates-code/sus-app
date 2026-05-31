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

  // Product listing: /<slug>-i.<shop_id>.<item_id>
  // The slug often contains the seller's display name ("dreame-official-store"),
  // sometimes the product name ("cheap-puma-shoes"). We capture it as best-effort
  // seller_handle for Reddit search — false positives are filtered downstream
  // by requiring scam-flag terms to co-occur.
  const listingMatch = path.match(/^\/(.+?)-i\.(\d+)\.(\d+)\/?$/i);
  if (listingMatch) {
    const slug = listingMatch[1];
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: listingMatch[2],
      item_id: listingMatch[3],
      seller_handle: slugToHandle(slug),
    };
  }

  // Product listing (older form): /product/<shop_id>/<item_id>
  // No slug here, so we look at the ?seoName= query param as a last-resort
  // source of human-readable text. URL-decoded, with %20 → space.
  const altListing = path.match(/^\/product\/(\d+)\/(\d+)\/?$/i);
  if (altListing) {
    const seoName = url.searchParams.get("seoName");
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: altListing[1],
      item_id: altListing[2],
      seller_handle: seoName ? slugToHandle(seoName) : null,
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

  // Vanity shop URL: /<seller_username> (single-segment path, not "shop"/"product")
  const vanityMatch = path.match(/^\/([A-Za-z0-9_.-]+)\/?$/);
  if (vanityMatch && !["shop", "product", "mall", "search"].includes(vanityMatch[1].toLowerCase())) {
    return {
      url: url.toString(),
      domain,
      marketplace: "shopee-ph",
      shop_id: null,
      item_id: null,
      seller_handle: slugToHandle(vanityMatch[1]),
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

// Converts a URL slug ("dreame-official-store" or "Dreame%20Official%20Store")
// into a search-friendly string ("dreame official store"). Lowercases for
// match consistency. URL-decodes and replaces hyphens/underscores with spaces.
function slugToHandle(slug: string): string {
  try {
    const decoded = decodeURIComponent(slug);
    return decoded.replace(/[-_]+/g, " ").trim().toLowerCase();
  } catch {
    return slug.replace(/[-_]+/g, " ").trim().toLowerCase();
  }
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

  // Shop product URLs from the shop-XX.tiktok.com subdomain (the dedicated shop
  // surface — e.g. shop-ph.tiktok.com/view/product/<numeric_id>, sometimes also
  // shop.tiktok.com/...). Product ID is the trailing numeric segment after
  // /view/product/ or /product/. We extract it as item_id so the product
  // scraper can fetch it; seller @username isn't in the URL so shop_id is null
  // until the scraper resolves it from the page body.
  const host = url.host.toLowerCase();
  const isShopSubdomain = host.startsWith("shop-") || host.startsWith("shop.");
  const productPathMatch = url.pathname.match(/\/(?:view\/)?product\/(\d+)/i);
  if (isShopSubdomain && productPathMatch) {
    return {
      url: url.toString(),
      domain,
      marketplace: "tiktok-shop",
      shop_id: null,
      item_id: productPathMatch[1],
    };
  }

  // /@username[/video/<id>]
  const usernameVideo = url.pathname.match(/^\/@([^\/]+)(?:\/video\/(\d+))?/);
  if (usernameVideo) {
    return {
      url: url.toString(),
      domain,
      marketplace: "tiktok-shop",
      shop_id: usernameVideo[1],
      item_id: usernameVideo[2] ?? null,
      seller_handle: usernameVideo[1],
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
    const handle = handleMatch[1];
    return {
      url: url.toString(),
      domain,
      marketplace: "facebook",
      shop_id: handle,
      item_id: null,
      // Numeric "handles" are just profile IDs, not useful for text search.
      seller_handle: /^\d+$/.test(handle) ? null : handle,
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
      seller_handle: profileMatch[1],
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

// PRD §1 scopes Sus to *product/seller listings* — TikTok Shop, Shopee, Lazada,
// FB Marketplace, IG, plus independent dropshipper sites. The gate's job is to
// reject anything that clearly isn't a product the user is about to buy, before
// it burns quota and a 25s scrape returning "the domain has a long history" on
// a news site or someone's Vercel app.
//
// Strategy: instead of trying to enumerate every non-commerce domain
// (whack-a-mole — new ones appear weekly), require POSITIVE evidence the URL
// looks like a product page. Specifically:
//
//   1. Known marketplace domain (Shopee/Lazada/TikTok/FB/IG/Temu) → scan
//   2. Explicit non-commerce list (news, search, social, encyclopedias) → gate
//   3. Institutional TLD (.gov, .edu, .mil) → gate
//   4. Dev/hosting platform (vercel.app, netlify.app, github.io, etc.) → gate
//   5. URL has a meaningful path (not just "/" or empty) → scan
//   6. Otherwise (bare domain, root path, no query) → gate as "homepage"
//
// Rule 5 is the concession to PRD line 22 (independent dropshipper sites):
// any URL with a real path is plausibly a product page on an unknown shop, so
// we let it through. The only URLs we gate generically are bare-domain inputs
// like "vercel.app" or "amazon.com" with no path — those are home pages, not
// listings, and the user almost certainly pasted them by accident.

// Marketplace domains the normalize parsers handle. classifyNonCommerce sees
// these too (it runs at the API boundary before normalize), so we short-circuit
// to null on a match so marketplace URLs always pass through.
const MARKETPLACE_DOMAINS: ReadonlySet<string> = new Set([
  "shopee.ph",
  "lazada.com.ph",
  "tiktok.com",
  "vt.tiktok.com",
  "temu.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
]);

const NON_COMMERCE_DOMAINS: ReadonlySet<string> = new Set([
  // PH news
  "abs-cbn.com",
  "gmanetwork.com",
  "rappler.com",
  "philstar.com",
  "inquirer.net",
  "manilatimes.net",
  "cnnphilippines.com",
  "mb.com.ph",
  "businessworld-online.com",
  "bworldonline.com",
  // Global news / media
  "bbc.com",
  "bbc.co.uk",
  "cnn.com",
  "nytimes.com",
  "reuters.com",
  "theguardian.com",
  "washingtonpost.com",
  "ft.com",
  "wsj.com",
  "bloomberg.com",
  "aljazeera.com",
  "apnews.com",
  "npr.org",
  // Encyclopedias / reference
  "wikipedia.org",
  "wikimedia.org",
  "britannica.com",
  // Search engines
  "google.com",
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "baidu.com",
  // Social platforms not on our marketplace allowlist
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "reddit.com",
  "linkedin.com",
  "pinterest.com",
  "tumblr.com",
  "snapchat.com",
  "threads.net",
  "mastodon.social",
  // Code hosts / dev tools
  "github.com",
  "gitlab.com",
  "stackoverflow.com",
]);

const NON_COMMERCE_TLD_SUFFIXES: readonly string[] = [
  ".gov",
  ".gov.ph",
  ".gov.us",
  ".gov.uk",
  ".gov.au",
  ".gob.ph",
  ".edu",
  ".edu.ph",
  ".ac.uk",
  ".mil",
];

// Hosting / developer platforms. Matched as full domain OR as a suffix
// (so my-app.vercel.app is gated alongside vercel.app itself — depends on
// whether tldts treats the platform as a public suffix).
const DEV_PLATFORM_HOSTS: readonly string[] = [
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "github.io",
  "herokuapp.com",
  "fly.dev",
  "replit.app",
  "repl.co",
  "railway.app",
  "firebaseapp.com",
  "web.app",
  "deno.dev",
  "workers.dev",
];

// "Meaningful" path = anything beyond bare root. A single product slug like
// /red-sneakers counts; just "/" doesn't.
function hasMeaningfulPath(url: URL): boolean {
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length > 0) return true;
  // Path is bare "/" — check for non-tracking query params. utm_*, fbclid,
  // gclid, ref are share-tracking junk that doesn't indicate a product page.
  const meaningful = Array.from(url.searchParams.keys()).filter(
    (k) =>
      !k.toLowerCase().startsWith("utm_") &&
      k.toLowerCase() !== "fbclid" &&
      k.toLowerCase() !== "gclid" &&
      k.toLowerCase() !== "ref" &&
      k.toLowerCase() !== "source",
  );
  return meaningful.length > 0;
}

export type NonCommerceCategory =
  | "news"
  | "social"
  | "search"
  | "institutional"
  | "reference"
  | "dev"
  | "homepage";

// Returns the gate reason if the URL should be rejected, null if it should
// proceed to the scan pipeline. Category is informational — the user-facing
// message is the same regardless ("paste a product link").
export function classifyNonCommerce(rawUrl: string): NonCommerceCategory | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const domain = getDomain(withScheme, { validHosts: ["localhost"] });
  if (!domain) return null;
  const lowered = domain.toLowerCase();

  // 1. Marketplaces always pass through.
  if (MARKETPLACE_DOMAINS.has(lowered)) return null;

  // 2. Explicit non-commerce list.
  if (NON_COMMERCE_DOMAINS.has(lowered)) {
    if (lowered === "google.com" || lowered === "bing.com" || lowered === "yahoo.com" || lowered === "duckduckgo.com" || lowered === "baidu.com") return "search";
    if (lowered === "wikipedia.org" || lowered === "wikimedia.org" || lowered === "britannica.com") return "reference";
    if (lowered === "twitter.com" || lowered === "x.com" || lowered === "youtube.com" || lowered === "youtu.be" || lowered === "reddit.com" || lowered === "linkedin.com" || lowered === "pinterest.com" || lowered === "tumblr.com" || lowered === "snapchat.com" || lowered === "threads.net" || lowered === "mastodon.social" || lowered === "github.com" || lowered === "gitlab.com" || lowered === "stackoverflow.com") return "social";
    return "news";
  }

  // 3. Institutional TLDs.
  for (const suffix of NON_COMMERCE_TLD_SUFFIXES) {
    if (lowered.endsWith(suffix)) return "institutional";
  }

  // 4. Dev / hosting platforms — matches the platform domain itself AND any
  // subdomain hosted on it. Regardless of path; nothing hosted on a free
  // dev-platform domain is a real commerce site we'd want to evaluate.
  for (const host of DEV_PLATFORM_HOSTS) {
    if (lowered === host || lowered.endsWith("." + host)) return "dev";
  }

  // 5. Has a real path (or non-tracking query) → assume product/listing page.
  if (hasMeaningfulPath(url)) return null;

  // 6. Bare domain or root-only URL → almost certainly a homepage, not a
  // product listing. Gate.
  return "homepage";
}
