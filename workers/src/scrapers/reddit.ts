import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

// PH-focused subreddits where scam reports actually surface, plus the global
// scam communities. r/PhilippinesScams + r/ShopeeOL are the highest-signal
// for Sus's primary use case (Shopee/Lazada sellers) since they're populated
// by Filipino shoppers comparing notes on specific stores.
const SUBREDDITS = [
  "PhilippinesScams",
  "ShopeeOL",
  "buhaydigital",
  "philippines",
  "scams",
  "Flipping",
] as const;
const FLAG_TERMS = /(scam|fake|fraud|legit|sketchy|sketch|warning)/i;
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
  // including unrelated documentation placeholders ("see example.com for details").
  // Require the search term's distinctive words to actually appear in the post body
  // or title before treating it as evidence about this seller. Multi-word handles
  // ("dreame official store") match posts that say "Dreame" or "Dreame PH" too —
  // we AND on words ≥3 chars, ignoring order, so reasonable variants still match
  // but unrelated docs that just happen to contain "store" don't pass.
  const matcher = buildMatcher(searchTerm);
  const aboutSeller = allPosts.filter((p) =>
    matcher(`${p.title ?? ""} ${p.selftext ?? ""}`),
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
// would be noise — e.g. a marketplace listing with a numeric-only seller ID
// and no other handle.
function pickSearchTerm(data: ScrapeJob, domain: string): string | null {
  // Best case: a human-readable seller handle was extracted during URL
  // normalization (Shopee slug, TikTok/IG @handle, FB page name). Use that
  // because it actually surfaces seller-specific posts on Reddit.
  if (data.seller_handle && data.seller_handle.trim().length >= 3) {
    // Strip leading "@" if present — Reddit's search treats @ as a separator
    // and "@oxgn_official" matches fewer posts than "oxgn_official".
    return data.seller_handle.replace(/^@/, "").trim();
  }

  // Marketplaces where the only identifier is a numeric ID (Shopee shop_id
  // with no SEO slug, Lazada item_id, Temu goods_id, FB profile.php numeric
  // id, FB marketplace item_id) — Reddit chatter about the marketplace itself
  // is not relevant to this specific seller. Skip Reddit.
  if (
    data.marketplace === "shopee-ph" ||
    data.marketplace === "lazada-ph" ||
    data.marketplace === "temu" ||
    data.marketplace === "facebook" ||
    data.marketplace === "instagram" ||
    data.marketplace === "tiktok-shop"
  ) {
    return null;
  }

  // Standalone domain (non-marketplace) — search the domain as before. This is
  // the original behavior for things like dropshipper sites and major brands.
  return domain;
}

// Splits the search term into distinctive words and returns a matcher that
// accepts text containing ALL of them (in any order, case-insensitive).
// Words shorter than 3 chars are dropped — they're either filler ("of", "to")
// or too generic to be evidence. If nothing meaningful remains, returns a
// matcher that rejects everything — better to drop the source than feed noise
// to synthesis.
function buildMatcher(searchTerm: string): (text: string) => boolean {
  const words = searchTerm
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return () => false;
  return (text: string) => {
    const lower = text.toLowerCase();
    return words.every((w) => lower.includes(w));
  };
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
