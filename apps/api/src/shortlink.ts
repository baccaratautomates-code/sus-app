// TikTok (and other) short-link resolver.
//
// Why this exists: TikTok's "Copy link" on a Shop listing hands the user a
// short share URL like https://vt.tiktok.com/ZS92yXyBvVm6B-UZmsb/ — an opaque
// 301 redirect. Our normalize.ts is synchronous-by-design (no HTTP), so it
// can't see through the shortener: it tags the URL as tiktok-shop with
// shop_id=null + item_id=null, and BOTH TikTok scrapers then no-op (they need
// a handle or a product id). The whole scan degrades to running trustpilot /
// whois / wayback against bare "tiktok.com" — pure noise — and the user never
// gets the tailored "TikTok Shop product can't be checked" message that the
// detectUnsupportedMarketplace() gate already knows how to give.
//
// The fix: resolve the shortener BEFORE normalize + the unsupported gate, so
// the canonical URL (e.g. tiktok.com/view/product/<id>) flows through the rest
// of the pipeline. As a bonus, TikTok's redirect target carries an `og_info`
// query param with the product title + image — which we surface as a thumbnail
// even though the product page body itself isn't scrapable.

// Hosts whose URLs are opaque redirects worth following. Kept tight on purpose:
// every host here costs one extra HTTP round-trip on the scan critical path, so
// we only list shorteners we actually see in share sheets.
const SHORTLINK_HOSTS = new Set([
  "vt.tiktok.com",
  "vm.tiktok.com",
]);

// Total budget for the whole redirect chain. The shortener is a lightweight CDN
// redirect, so this is generous; we'd rather fall back to the original URL than
// stall the scan.
const RESOLVE_TIMEOUT_MS = 6_000;
const MAX_HOPS = 5;

export interface ResolvedLink {
  // The canonical URL after following redirects (or the original on any failure).
  url: string;
  // Product title pulled from TikTok's `og_info` param, when present.
  ogTitle: string | null;
  // Product image URL pulled from `og_info` — a real TikTok CDN product photo,
  // usable as a thumbnail even when the listing body can't be scraped.
  ogImage: string | null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

// Resolve a share/short link to its canonical destination. For non-shortener
// URLs this is a no-op (returns the input unchanged, no network call). Any
// failure degrades gracefully to the original URL.
export async function resolveShortLink(input: string): Promise<ResolvedLink> {
  const host = hostOf(input);
  if (!host || !SHORTLINK_HOSTS.has(host)) {
    return { url: input, ogTitle: null, ogImage: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    let current = input;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // A real mobile UA — TikTok's redirector serves the og_info-rich
          // Location to app/browser user agents.
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      // Not a redirect → we've arrived (or the host returned a body). Use
      // res.url when available (set when the runtime auto-followed), else the
      // current URL.
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) {
        const finalUrl = res.url && /^https?:/i.test(res.url) ? res.url : current;
        return finalize(input, finalUrl);
      }

      // Resolve relative redirects against the current URL.
      try {
        current = new URL(location, current).toString();
      } catch {
        return finalize(input, current);
      }

      // Once we've left the shortener for a real tiktok.com URL we're done —
      // no need to keep following into app-store / login redirects.
      const nextHost = hostOf(current);
      if (nextHost && !SHORTLINK_HOSTS.has(nextHost)) {
        return finalize(input, current);
      }
    }
    // Ran out of hops — use whatever we last landed on.
    return finalize(input, current);
  } catch (err) {
    console.log(
      `[shortlink] resolve failed for ${input}: ${(err as Error).name === "AbortError" ? `timeout (${RESOLVE_TIMEOUT_MS}ms)` : (err as Error).message} — using original`,
    );
    return { url: input, ogTitle: null, ogImage: null };
  } finally {
    clearTimeout(timer);
  }
}

// Builds the ResolvedLink from a final URL, mining TikTok's og_info param for a
// product title + image when present.
function finalize(original: string, finalUrl: string): ResolvedLink {
  const { ogTitle, ogImage } = extractOgInfo(finalUrl);
  if (finalUrl !== original) {
    console.log(`[shortlink] ${original} → ${finalUrl}${ogTitle ? ` (og: "${ogTitle}")` : ""}`);
  }
  return { url: finalUrl, ogTitle, ogImage };
}

// TikTok share redirects carry ?og_info=<url-encoded JSON> with the listing's
// title + image, e.g. {"title":"MOPHE EYESHADOW PALETTE","image":"https://…"}.
// Parse it defensively — it's a best-effort bonus, never required.
function extractOgInfo(url: string): { ogTitle: string | null; ogImage: string | null } {
  try {
    const raw = new URL(url).searchParams.get("og_info");
    if (!raw) return { ogTitle: null, ogImage: null };
    const parsed = JSON.parse(raw) as { title?: unknown; image?: unknown };
    const ogTitle = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : null;
    let ogImage = typeof parsed.image === "string" && parsed.image.trim() ? parsed.image.trim() : null;
    if (ogImage && ogImage.startsWith("//")) ogImage = `https:${ogImage}`;
    return { ogTitle, ogImage };
  } catch {
    return { ogTitle: null, ogImage: null };
  }
}
