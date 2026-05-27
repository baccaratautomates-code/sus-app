import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

const SUBREDDITS = ["scams", "Flipping", "philippines"] as const;
const FLAG_TERMS = /(scam|fake|fraud|legit)/i;
const USER_AGENT = "sus-app/0.1 (https://github.com/disruptorsmedia/sus)";
const MAX_FLAGGED_POSTS = 5;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface RedditPost {
  title?: string;
  selftext?: string;
  permalink?: string;
  subreddit?: string;
}

interface RedditChild {
  data?: RedditPost;
}

interface RedditListing {
  data?: { children?: RedditChild[] };
}

export async function redditScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[reddit] no domain from target_url="${data.target_url}" — empty result`);
    return emptyResult("reddit", id);
  }

  // For marketplace URLs, searching for the marketplace domain itself surfaces
  // platform-wide scam chatter that has nothing to do with the specific seller.
  // Pick the right search term:
  //   • If we have a human-readable seller handle, search for that
  //   • If we only have a numeric ID (Shopee shop_id, Temu item_id), skip Reddit
  //     entirely — platform-level chatter is noise for a specific-seller scan
  //   • Standalone domains (no marketplace): search the domain as before
  const searchTerm = pickSearchTerm(data, domain);
  if (!searchTerm) {
    console.log(
      `[reddit] skipping for marketplace=${data.marketplace} with no human-readable seller handle — platform-level Reddit chatter is noise for a specific-seller scan`,
    );
    return {
      source: "reddit",
      job_id: id,
      signals: [
        {
          type: "seller_reputation",
          weight: 0,
          detail: `Reddit search skipped: this is a ${data.marketplace} listing without a public seller handle Reddit could search for. Platform-wide Reddit chatter about ${data.marketplace} is not evidence about this specific seller.`,
          source: {
            url: `https://www.reddit.com/`,
            title: "Reddit (skipped for this marketplace scan)",
            signal_type: "seller_reputation",
          },
        },
      ],
      scraped_at: new Date().toISOString(),
    };
  }

  console.log(`[reddit] lookup start: searchTerm="${searchTerm}" (marketplace=${data.marketplace ?? "none"})`);
  const startedAt = Date.now();

  const perSubreddit = await Promise.all(
    SUBREDDITS.map((sub) =>
      searchSubreddit(sub, searchTerm).catch((err) => {
        console.warn(`[reddit] r/${sub} search failed: ${(err as Error).message}`);
        return [] as RedditChild[];
      }),
    ),
  );

  const allPosts = perSubreddit.flat().map((c) => c.data).filter((p): p is RedditPost => !!p);

  // Reddit's full-text search returns posts that contain the query string anywhere,
  // including unrelated documentation placeholders (e.g. "see example.com for details").
  // Require the search term to actually appear in the post body/title before treating
  // it as evidence about this seller.
  const termRe = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, "i");
  const aboutSeller = allPosts.filter((p) =>
    termRe.test(`${p.title ?? ""} ${p.selftext ?? ""}`),
  );
  const flagged = aboutSeller.filter((p) =>
    FLAG_TERMS.test(`${p.title ?? ""} ${p.selftext ?? ""}`),
  );

  const baselineSource: Source = {
    url: `https://www.reddit.com/search?q=${encodeURIComponent(searchTerm)}`,
    title: "Reddit search results",
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: `Reddit search for "${searchTerm}" across r/${SUBREDDITS.join(", r/")}: ${aboutSeller.length} posts actually mentioning it (of ${allPosts.length} returned), ${flagged.length} with scam/fake/fraud/legit context.`,
      source: baselineSource,
    },
  ];

  for (const post of flagged.slice(0, MAX_FLAGGED_POSTS)) {
    if (!post.permalink) continue;
    const match = FLAG_TERMS.exec(`${post.title ?? ""} ${post.selftext ?? ""}`);
    signals.push({
      type: "seller_reputation",
      weight: 0.9,
      detail: `r/${post.subreddit ?? "?"}: "${post.title ?? "(no title)"}" mentions "${match?.[0] ?? "flag term"}".`,
      source: {
        url: `https://www.reddit.com${post.permalink}`,
        title: post.title ?? "Reddit post",
        signal_type: "seller_reputation",
      },
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[reddit] lookup done: searchTerm="${searchTerm}" posts=${allPosts.length} aboutSeller=${aboutSeller.length} flagged=${flagged.length} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "reddit",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Decides what to actually search Reddit for. Returns null when Reddit search
// would be noise — e.g. a marketplace listing with a numeric-only seller ID.
function pickSearchTerm(data: ScrapeJob, domain: string): string | null {
  // Marketplaces where shop_id is a human-readable handle (TikTok @username,
  // Facebook page handle, Instagram @username) — search for that, not the domain.
  if (data.marketplace === "tiktok-shop" && data.shop_id) {
    // Username-style; people in posts often write it as "@username"
    return `@${data.shop_id}`;
  }
  if (data.marketplace === "instagram" && data.shop_id) {
    return `@${data.shop_id}`;
  }
  if (data.marketplace === "facebook" && data.shop_id && !/^\d+$/.test(data.shop_id)) {
    // FB page handle — but only if it's not a numeric id (numeric IDs aren't
    // searchable in the same way real names are).
    return data.shop_id;
  }

  // Marketplaces where the only identifier is a numeric ID (Shopee shop_id,
  // Lazada item_id, Temu goods_id, FB profile.php numeric id, FB marketplace
  // item_id) — Reddit chatter about the marketplace itself is not relevant
  // to this specific seller. Skip Reddit.
  if (
    data.marketplace === "shopee-ph" ||
    data.marketplace === "lazada-ph" ||
    data.marketplace === "temu" ||
    (data.marketplace === "facebook" && (!data.shop_id || /^\d+$/.test(data.shop_id))) ||
    (data.marketplace === "instagram" && !data.shop_id)
  ) {
    return null;
  }

  // Standalone domain (non-marketplace) — search the domain as before. This is
  // the original behavior for things like dropshipper sites and major brands.
  return domain;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchSubreddit(sub: string, query: string): Promise<RedditChild[]> {
  const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&limit=10`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
    timeoutMs: 10_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as RedditListing;
  return json.data?.children ?? [];
}
