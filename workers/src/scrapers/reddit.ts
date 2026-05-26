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

  console.log(`[reddit] lookup start: ${domain}`);
  const startedAt = Date.now();

  const perSubreddit = await Promise.all(
    SUBREDDITS.map((sub) =>
      searchSubreddit(sub, domain).catch((err) => {
        console.warn(`[reddit] r/${sub} search failed: ${(err as Error).message}`);
        return [] as RedditChild[];
      }),
    ),
  );

  const allPosts = perSubreddit.flat().map((c) => c.data).filter((p): p is RedditPost => !!p);

  // Reddit's full-text search returns posts that contain the query string anywhere,
  // including unrelated documentation placeholders (e.g. "see example.com for details").
  // Require the domain to actually appear in the post body/title before treating it
  // as evidence about this seller.
  const domainRe = new RegExp(`\\b${escapeRegex(domain)}\\b`, "i");
  const aboutDomain = allPosts.filter((p) =>
    domainRe.test(`${p.title ?? ""} ${p.selftext ?? ""}`),
  );
  const flagged = aboutDomain.filter((p) =>
    FLAG_TERMS.test(`${p.title ?? ""} ${p.selftext ?? ""}`),
  );

  const baselineSource: Source = {
    url: `https://www.reddit.com/search?q=${encodeURIComponent(domain)}`,
    title: "Reddit search results",
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [
    {
      type: "seller_reputation",
      weight: 0,
      detail: `Reddit search for "${domain}" across r/${SUBREDDITS.join(", r/")}: ${aboutDomain.length} posts actually mentioning the domain (of ${allPosts.length} returned), ${flagged.length} with scam/fake/fraud/legit context.`,
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
    `[reddit] lookup done: ${domain} posts=${allPosts.length} flagged=${flagged.length} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "reddit",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchSubreddit(sub: string, domain: string): Promise<RedditChild[]> {
  const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(domain)}&restrict_sr=1&limit=10`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": USER_AGENT, accept: "application/json" },
    timeoutMs: 10_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as RedditListing;
  return json.data?.children ?? [];
}
