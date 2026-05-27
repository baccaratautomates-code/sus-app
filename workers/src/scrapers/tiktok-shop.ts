import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, fetchWithTimeout } from "./_lib";
import { getTiktokHeaders } from "./_tiktok-auth";

// TikTok creator + shop scraper.
//
// Unlike Shopee/Lazada which expose neat JSON APIs (with a cookie warmup),
// TikTok aggressively fights scraping. The richest practical surface for us is
// the creator profile HTML page, which embeds a JSON state blob under either:
//   <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">…</script>
//   <script id="SIGI_STATE" type="application/json">…</script>
//
// From that blob we can usually extract: nickname, follower count, following count,
// heart/like count, video count, verified badge. Account creation date is NOT
// reliably exposed.
//
// This scraper is best-effort. Many runs will 403 or get an empty blob; we still
// emit at least a baseline signal so synthesis knows TikTok was checked.

const TIMEOUT_MS = 12_000;

// PH wedge calibration for a TikTok Shop seller.
const LOW_FOLLOWER_THRESHOLD = 1_000;       // realistic floor for a shop you'd actually buy from
const HIGH_FOLLOWER_THRESHOLD = 100_000;    // strong social-proof signal

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

// Shape of the SIGI_STATE / universal blob — we probe defensively because TikTok
// changes the structure frequently. These are the fields we care about, expressed
// as a loose union of the shapes we've seen in the wild.
interface UserModule {
  user?: TiktokUser;
  stats?: TiktokStats;
}

interface TiktokUser {
  id?: string;
  uniqueId?: string;
  nickname?: string;
  verified?: boolean;
  signature?: string;
  secUid?: string;
  privateAccount?: boolean;
}

interface TiktokStats {
  followerCount?: number;
  followingCount?: number;
  heart?: number;
  heartCount?: number;
  videoCount?: number;
  diggCount?: number;
}

export async function tiktokShopScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  if (data.marketplace !== "tiktok-shop" || !data.shop_id) {
    return emptyResult("tiktok-shop", id);
  }

  const username = data.shop_id;
  const profileUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
  console.log(`[tiktok-shop] lookup start: @${username}`);
  const startedAt = Date.now();

  let html: string;
  try {
    const res = await fetchWithTimeout(profileUrl, {
      headers: getTiktokHeaders("https://www.tiktok.com/"),
      timeoutMs: TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn(`[tiktok-shop] HTTP ${res.status} for @${username}`);
      return emptyResult("tiktok-shop", id);
    }
    html = await res.text();
  } catch (err) {
    console.error(`[tiktok-shop] fetch failed for @${username}: ${(err as Error).message}`);
    return emptyResult("tiktok-shop", id);
  }

  const profile = extractProfile(html);

  const source: Source = {
    url: profileUrl,
    title: profile?.user?.nickname
      ? `TikTok: ${profile.user.nickname} (@${username})`
      : `TikTok profile @${username}`,
    signal_type: "seller_reputation",
  };

  if (!profile) {
    // Even when we can't parse, surface that we checked. Saves Groq from
    // wondering whether the URL is "unscanned" vs "scanned but empty".
    console.warn(`[tiktok-shop] no parseable profile JSON for @${username}`);
    return {
      source: "tiktok-shop",
      job_id: id,
      signals: [
        {
          type: "seller_reputation",
          weight: 0,
          detail: `TikTok creator @${username}: profile page fetched but no public stats were extractable. TikTok limits public data.`,
          source,
        },
      ],
      scraped_at: new Date().toISOString(),
    };
  }

  const user = profile.user ?? {};
  const stats = profile.stats ?? {};
  const followers = stats.followerCount ?? null;
  const videoCount = stats.videoCount ?? null;
  const hearts = stats.heart ?? stats.heartCount ?? null;
  const verified = user.verified === true;
  const privateAccount = user.privateAccount === true;
  const nickname = user.nickname ?? null;

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(username, nickname, followers, videoCount, hearts, verified, privateAccount),
      source,
    },
  ];

  // Positive signals
  if (verified) {
    signals.push({
      type: "seller_reputation",
      weight: -0.8,
      detail: `TikTok account @${username} is verified.`,
      source,
    });
  }
  if (followers !== null && followers >= HIGH_FOLLOWER_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: -0.4,
      detail: `TikTok account @${username} has ${followers.toLocaleString()} followers — strong social proof.`,
      source,
    });
  }

  // Negative signals
  if (followers !== null && followers < LOW_FOLLOWER_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.6,
      detail: `TikTok account @${username} has only ${followers} followers — limited social proof for a shop.`,
      source,
    });
  }
  if (privateAccount) {
    signals.push({
      type: "seller_reputation",
      weight: 0.5,
      detail: `TikTok account @${username} is private — unusual for a legitimate shop, which should be publicly browsable.`,
      source,
    });
  }
  if (videoCount !== null && videoCount === 0) {
    signals.push({
      type: "seller_reputation",
      weight: 0.4,
      detail: `TikTok account @${username} has zero public videos — sellers normally post product content.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[tiktok-shop] lookup done: @${username} nickname="${nickname ?? "?"}" followers=${followers ?? "?"} verified=${verified} videos=${videoCount ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "tiktok-shop",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Probe known JSON-blob shapes. Returns the first user+stats record we find.
function extractProfile(html: string): UserModule | null {
  // 1. Newer pages: __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universal = html.match(
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (universal) {
    try {
      const parsed = JSON.parse(universal[1]) as Record<string, unknown>;
      const found = findUserModuleDeep(parsed);
      if (found) return found;
    } catch {
      // fall through
    }
  }

  // 2. Older pages: SIGI_STATE
  const sigi = html.match(/<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigi) {
    try {
      const parsed = JSON.parse(sigi[1]) as Record<string, unknown>;
      // SIGI_STATE.UserModule.users[username] + .stats[username]
      const um = (parsed["UserModule"] ?? null) as Record<string, unknown> | null;
      if (um) {
        const users = (um["users"] ?? {}) as Record<string, TiktokUser>;
        const stats = (um["stats"] ?? {}) as Record<string, TiktokStats>;
        const firstKey = Object.keys(users)[0];
        if (firstKey) {
          return { user: users[firstKey], stats: stats[firstKey] };
        }
      }
    } catch {
      // fall through
    }
  }

  return null;
}

// Walk an arbitrary JSON tree looking for a node that has both user+stats keys
// — the universal blob's structure varies and embedding the data several
// levels deep is common. Conservative: stops at first plausible hit.
function findUserModuleDeep(node: unknown, depth = 0): UserModule | null {
  if (depth > 6 || node === null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  // Match a user object containing followerCount or a UserInfo-shaped wrapper.
  if (
    typeof obj["user"] === "object" &&
    typeof obj["stats"] === "object" &&
    obj["stats"] !== null &&
    (obj["stats"] as Record<string, unknown>)["followerCount"] !== undefined
  ) {
    return { user: obj["user"] as TiktokUser, stats: obj["stats"] as TiktokStats };
  }
  if (
    typeof obj["userInfo"] === "object" &&
    obj["userInfo"] !== null
  ) {
    const ui = obj["userInfo"] as Record<string, unknown>;
    if (typeof ui["user"] === "object" && typeof ui["stats"] === "object") {
      return { user: ui["user"] as TiktokUser, stats: ui["stats"] as TiktokStats };
    }
  }
  for (const value of Object.values(obj)) {
    const found = findUserModuleDeep(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function formatBaseline(
  username: string,
  nickname: string | null,
  followers: number | null,
  videoCount: number | null,
  hearts: number | null,
  verified: boolean,
  privateAccount: boolean,
): string {
  const parts = [`TikTok @${username}${nickname ? ` (${nickname})` : ""}`];
  if (followers !== null) parts.push(`${followers.toLocaleString()} followers`);
  if (videoCount !== null) parts.push(`${videoCount} videos`);
  if (hearts !== null) parts.push(`${hearts.toLocaleString()} hearts`);
  if (verified) parts.push("verified");
  if (privateAccount) parts.push("private account");
  return parts.join(", ");
}
