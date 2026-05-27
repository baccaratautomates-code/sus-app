import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getMetaHeaders } from "./_meta-auth";

// Instagram scraper. Mostly hits the og: meta tags on a public profile page;
// IG's bio + follower count is sometimes embedded in og:description in the
// form "X Followers, Y Following, Z Posts - @handle on Instagram: ..."
//
// IG aggressively serves a login wall to non-authed requests. We extract what
// we can from the meta tags and explicitly tell synthesis when data is sparse.

const TIMEOUT_MS = 10_000;
const HIGH_FOLLOWER_THRESHOLD = 100_000;
const LOW_FOLLOWER_THRESHOLD = 1_000;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function instagramProfileScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "instagram") {
    return emptyResult("instagram-profile", id);
  }

  const subject = data.shop_id
    ? `@${data.shop_id}`
    : data.item_id
      ? `Post ${data.item_id}`
      : "Instagram URL";

  const pageUrl = data.target_url;
  console.log(`[instagram-profile] lookup start: ${subject}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(pageUrl, {
      headers: getMetaHeaders("https://www.instagram.com/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[instagram-profile] HTTP ${res.status} for ${pageUrl}`);
      return emptyResult("instagram-profile", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(`[instagram-profile] fetch failed for ${pageUrl}: ${(err as Error).message}`);
    return emptyResult("instagram-profile", id);
  }

  const title = matchOg(html, "og:title") ?? matchTagText(html, "title");
  const description = matchOg(html, "og:description");
  const verified = /\bVerified Account\b/.test(html) || /\b"is_verified":true/.test(html);

  // og:description on a profile usually looks like:
  //   "12.3K Followers, 543 Following, 89 Posts - @handle on Instagram: \"bio text\""
  const stats = description ? parseStatsFromDescription(description) : null;

  const source: Source = {
    url: pageUrl,
    title: title ? `Instagram: ${title}` : `Instagram ${subject}`,
    signal_type: "seller_reputation",
  };

  const loginWalled =
    !title || /\blog ?in\b/i.test(title ?? "") || (!description && !stats);

  const signals: Signal[] = [];

  if (loginWalled) {
    signals.push({
      type: "seller_reputation",
      weight: 0,
      detail: `Instagram ${subject} page is behind Instagram's login wall — public data is limited. We can confirm the URL points at a real Instagram asset, but follower count, post history, and bio are not exposed. The user should verify the account manually inside Instagram before purchasing.`,
      source,
    });
  } else {
    signals.push({
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(subject, title, description, stats, verified),
      source,
    });

    if (verified) {
      signals.push({
        type: "seller_reputation",
        weight: -0.7,
        detail: `Instagram account ${subject} is verified.`,
        source,
      });
    }

    if (stats?.followers !== undefined) {
      if (stats.followers >= HIGH_FOLLOWER_THRESHOLD) {
        signals.push({
          type: "seller_reputation",
          weight: -0.3,
          detail: `Instagram account ${subject} has ${stats.followers.toLocaleString()} followers — strong social proof.`,
          source,
        });
      } else if (stats.followers < LOW_FOLLOWER_THRESHOLD) {
        signals.push({
          type: "seller_reputation",
          weight: 0.5,
          detail: `Instagram account ${subject} has only ${stats.followers} followers — limited social proof for a shop.`,
          source,
        });
      }
    }

    if (stats?.posts !== undefined && stats.posts === 0) {
      signals.push({
        type: "seller_reputation",
        weight: 0.5,
        detail: `Instagram account ${subject} has zero posts — sellers typically have product content.`,
        source,
      });
    }
  }

  // PRD-aligned framing — Instagram shops are typically informal and have no
  // built-in buyer protection. Flag it once per scan.
  signals.push({
    type: "seller_reputation",
    weight: 0.2,
    detail: `Instagram shops are typically informal sellers operating outside any marketplace's buyer-protection program. PRD §3.2 flags Instagram listings as a higher-risk channel by default.`,
    source,
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[instagram-profile] lookup done: ${subject} title="${(title ?? "?").slice(0, 60)}" verified=${verified} followers=${stats?.followers ?? "?"} loginWalled=${loginWalled} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "instagram-profile",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

interface IgStats {
  followers?: number;
  following?: number;
  posts?: number;
}

function parseStatsFromDescription(description: string): IgStats | null {
  // Matches strings like "12.3K Followers" / "543 Following" / "89 Posts" / "1.2M Followers"
  const stats: IgStats = {};
  const followersMatch = description.match(/([\d.,]+[KM]?)\s+Followers/i);
  if (followersMatch) stats.followers = parseHumanNumber(followersMatch[1]);
  const followingMatch = description.match(/([\d.,]+[KM]?)\s+Following/i);
  if (followingMatch) stats.following = parseHumanNumber(followingMatch[1]);
  const postsMatch = description.match(/([\d.,]+[KM]?)\s+Posts?/i);
  if (postsMatch) stats.posts = parseHumanNumber(postsMatch[1]);
  return Object.keys(stats).length > 0 ? stats : null;
}

function parseHumanNumber(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const m = cleaned.match(/^([\d.]+)([KM]?)$/i);
  if (!m) return Number(cleaned) || 0;
  const n = Number(m[1]);
  const suffix = m[2]?.toUpperCase();
  if (!Number.isFinite(n)) return 0;
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  return Math.round(n);
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

function formatBaseline(
  subject: string,
  title: string | null,
  description: string | null,
  stats: IgStats | null,
  verified: boolean,
): string {
  const parts = [`Instagram ${subject}`];
  if (title) parts.push(`page title "${title}"`);
  if (stats?.followers !== undefined) parts.push(`${stats.followers.toLocaleString()} followers`);
  if (stats?.following !== undefined) parts.push(`${stats.following.toLocaleString()} following`);
  if (stats?.posts !== undefined) parts.push(`${stats.posts.toLocaleString()} posts`);
  if (verified) parts.push("verified");
  return parts.join(", ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
