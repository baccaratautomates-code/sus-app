import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getMetaHeaders } from "./_meta-auth";

// Facebook scraper. Handles three flavors of FB URL:
//   • Page / profile (the handle in shop_id)
//   • Marketplace listing (item_id present, shop_id null)
//   • Anything else under facebook.com — emits a "limited data" baseline
//
// FB walls almost all content behind login. From an anonymous fetch we can
// usually still get the page title, description, and image via Open Graph
// meta tags — that's enough to confirm the URL points at a real FB asset.
// For the wedge use case ("user pastes a FB Marketplace listing they're about
// to buy from"), even this partial coverage is better than nothing.

const TIMEOUT_MS = 10_000;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function facebookPageScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "facebook") {
    return emptyResult("facebook-page", id);
  }

  const pageUrl = data.target_url;
  const isMarketplace = data.item_id !== null;
  const subject = isMarketplace
    ? `Marketplace listing ${data.item_id}`
    : data.shop_id
      ? `Facebook page ${data.shop_id}`
      : "Facebook URL";

  console.log(`[facebook-page] lookup start: ${subject}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: getMetaHeaders("https://www.facebook.com/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[facebook-page] HTTP ${res.status} for ${pageUrl}`);
      return emptyResult("facebook-page", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(`[facebook-page] fetch failed for ${pageUrl}: ${(err as Error).message}`);
    return emptyResult("facebook-page", id);
  }

  const meta = extractOgMeta(html);
  const loginWalled = looksLikeLoginWall(html, meta);

  const source: Source = {
    url: pageUrl,
    title: meta.title ? `Facebook: ${meta.title}` : subject,
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [];

  if (loginWalled) {
    // Honest: we tried, FB blocked us. Tell synthesis so it doesn't read silence
    // as "everything is fine".
    signals.push({
      type: "seller_reputation",
      weight: 0,
      detail: `Facebook ${isMarketplace ? "Marketplace listing" : "page"} ${data.shop_id ?? data.item_id ?? ""} is behind Facebook's login wall — public data is limited. We can confirm the URL points at a real Facebook asset, but seller-level signals (rating, history, reviews) are not exposed publicly. The user should verify the seller manually inside Facebook before purchasing.`,
      source,
    });
  } else {
    signals.push({
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(subject, isMarketplace, meta),
      source,
    });

    // Generic red flag — accounts/listings with no description on FB are
    // unusual for real businesses (real sellers fill these out for discoverability).
    if (!meta.description) {
      signals.push({
        type: "seller_reputation",
        weight: 0.3,
        detail: `Facebook ${isMarketplace ? "listing" : "page"} has no description — legitimate sellers usually fill this out.`,
        source,
      });
    }
  }

  // PRD-aligned framing — for Marketplace specifically, surface the structural
  // risk so the model can reason about it.
  if (isMarketplace) {
    signals.push({
      type: "seller_reputation",
      weight: 0.2,
      detail: `Facebook Marketplace sellers are typically individuals (not registered businesses), so there is no formal seller rating, return policy, or buyer protection. PRD §3.2 flags FB Marketplace as a higher-risk channel by default.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[facebook-page] lookup done: ${subject} title="${(meta.title ?? "?").slice(0, 60)}" loginWalled=${loginWalled} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "facebook-page",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

interface OgMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  type: string | null;
}

function extractOgMeta(html: string): OgMeta {
  return {
    title: matchOg(html, "og:title") ?? matchTagText(html, "title"),
    description: matchOg(html, "og:description"),
    image: matchOg(html, "og:image"),
    type: matchOg(html, "og:type"),
  };
}

function matchOg(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function matchTagText(html: string, tag: string): string | null {
  const re = new RegExp(`<${escapeRegex(tag)}[^>]*>([^<]+)<\\/${escapeRegex(tag)}>`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function looksLikeLoginWall(html: string, meta: OgMeta): boolean {
  // FB serves a stripped page with "Log in or sign up" CTA when content is gated.
  // Detection heuristics: title contains "Log in to Facebook" or "Login • Facebook",
  // or the page is suspiciously small (<5KB) with no OG title.
  if (meta.title && /^log ?in/i.test(meta.title)) return true;
  if (meta.title && /facebook$/i.test(meta.title) && html.length < 8000) return true;
  if (!meta.title && !meta.description) return true;
  return false;
}

function formatBaseline(subject: string, isMarketplace: boolean, meta: OgMeta): string {
  const parts = [
    isMarketplace
      ? `Facebook Marketplace listing — ${subject}`
      : `Facebook page — ${subject}`,
  ];
  if (meta.title) parts.push(`title "${meta.title}"`);
  if (meta.description) parts.push(`description "${meta.description.slice(0, 120)}"`);
  return parts.join(", ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
