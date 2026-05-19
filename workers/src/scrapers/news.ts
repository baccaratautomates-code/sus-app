import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

const NEWS_API_URL = "https://newsapi.org/v2/everything";
const MAX_ARTICLES = 5;

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

interface NewsArticle {
  title?: string;
  description?: string;
  url?: string;
  source?: { name?: string };
  publishedAt?: string;
}

interface NewsResponse {
  status?: string;
  articles?: NewsArticle[];
}

export async function newsScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.warn("[news] NEWS_API_KEY not set — empty result");
    return emptyResult("news", id);
  }

  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[news] no domain — empty result`);
    return emptyResult("news", id);
  }

  console.log(`[news] lookup start: ${domain}`);
  const startedAt = Date.now();

  let body: NewsResponse;
  try {
    const q = `"${domain}" AND (scam OR fraud OR fake OR counterfeit)`;
    const url = `${NEWS_API_URL}?q=${encodeURIComponent(q)}&language=en&pageSize=${MAX_ARTICLES}&sortBy=relevancy`;
    const res = await fetchWithTimeout(url, {
      headers: { "X-Api-Key": apiKey, accept: "application/json" },
      timeoutMs: 10_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as NewsResponse;
  } catch (err) {
    console.error(`[news] fetch failed for ${domain}: ${(err as Error).message}`);
    return emptyResult("news", id);
  }

  const articles = (body.articles ?? []).filter((a) => a.url && a.title);

  const baselineSource: Source = {
    url: `https://newsapi.org/?q=${encodeURIComponent(domain)}`,
    title: `News mentions of ${domain}`,
    signal_type: "news",
  };

  const signals: Signal[] = [
    {
      type: "news",
      weight: 0,
      detail: `News search for "${domain}" + scam/fraud/fake/counterfeit: ${articles.length} article(s).`,
      source: baselineSource,
    },
  ];

  for (const article of articles) {
    const dateStr = article.publishedAt ? ` (${article.publishedAt.slice(0, 10)})` : "";
    signals.push({
      type: "news",
      weight: 0.8,
      detail: `${article.source?.name ?? "News"}: "${article.title}"${dateStr}.`,
      source: {
        url: article.url!,
        title: article.title!,
        signal_type: "news",
      },
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[news] lookup done: ${domain} articles=${articles.length} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "news",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}
