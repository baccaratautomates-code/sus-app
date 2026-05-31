import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain, fetchWithTimeout } from "./_lib";

// DTI Consumer Care scraper. PRD §3.2 lists DTI as a required PH-government
// trust source — the Department of Trade and Industry publishes consumer
// advisories, cease-and-desist orders, closure orders, and warning notices on
// dti.gov.ph. A seller appearing in those notices is the strongest possible
// negative signal a PH-context scan can find (a government agency naming them).
//
// Approach: query the DTI WordPress site search (?s=<term>) for the seller's
// human-readable handle. WordPress search returns posts matching title +
// content; we filter the results for known enforcement-action terms in the
// title and emit one signal per match.
//
// Free path — no API key. DTI's site search is publicly accessible and a
// WordPress install handles ?s= queries without bot-detection in practice.

const DTI_SEARCH_URL = "https://www.dti.gov.ph/";
const TIMEOUT_MS = 10_000;
const MAX_FLAGGED_RESULTS = 5;

// Title keywords that indicate a DTI enforcement action against a specific
// business. We filter on these instead of accepting every search hit because
// DTI also publishes general consumer-education content that happens to
// mention common words — those aren't evidence about this seller.
const ENFORCEMENT_TERMS = /(advisory|warning|alert|cease.?and.?desist|closure|order|illegal|unregistered|fraud|scam|fake|counterfeit|complaint)/i;

// Distinctive search-term threshold. Single-character or 1-2 char handles
// would surface noise; bail rather than spam DTI's search with bad queries.
const MIN_TERM_LENGTH = 3;

const USER_AGENT =
  "Mozilla/5.0 (compatible; SusBot/1.0; +https://sus.app)";

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function dtiScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const term = pickSearchTerm(data);
  if (!term) {
    console.log(
      `[dti] skipping: no searchable seller handle for marketplace=${data.marketplace ?? "none"}`,
    );
    return emptyResult("dti", id);
  }

  console.log(`[dti] lookup start: term="${term}"`);
  const startedAt = Date.now();

  const html = await fetchSearchHtml(term);
  if (!html) {
    console.warn(`[dti] search fetch failed for term="${term}"`);
    return emptyResult("dti", id);
  }

  const results = parseSearchResults(html);
  const matcher = buildMatcher(term);
  // Require the search term to actually appear in the result title — DTI's
  // WordPress search sometimes returns broad-match hits where the term only
  // appears via stemming or in unrelated content. We want title-level matches.
  const aboutSeller = results.filter((r) => matcher(r.title));
  const flagged = aboutSeller.filter((r) => ENFORCEMENT_TERMS.test(r.title));

  const baselineSource: Source = {
    url: `${DTI_SEARCH_URL}?s=${encodeURIComponent(term)}`,
    title: `DTI Consumer Care search for "${term}"`,
    signal_type: "ph_specific",
  };

  const signals: Signal[] = [
    {
      type: "ph_specific",
      weight: 0,
      detail: `DTI Consumer Care search for "${term}": ${results.length} indexed result(s), ${aboutSeller.length} mentioning seller in title, ${flagged.length} with enforcement-action keywords.`,
      source: baselineSource,
    },
  ];

  for (const result of flagged.slice(0, MAX_FLAGGED_RESULTS)) {
    const match = ENFORCEMENT_TERMS.exec(result.title);
    signals.push({
      // 1.0 weight — DTI is a Philippines-government source, the strongest
      // negative signal class in the PRD's signal hierarchy.
      type: "ph_specific",
      weight: 1.0,
      detail: `DTI: "${result.title}" — mentions "${match?.[0] ?? "enforcement term"}".`,
      source: {
        url: result.url,
        title: result.title,
        signal_type: "ph_specific",
      },
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[dti] lookup done: term="${term}" results=${results.length} aboutSeller=${aboutSeller.length} flagged=${flagged.length} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "dti",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Picks the term to search DTI for. Prefers the human-readable seller_handle
// (Shopee slug, TikTok/IG @handle) — that's what DTI would name in an
// advisory. Falls back to the registrable domain for non-marketplace URLs.
// Returns null when neither is usable.
function pickSearchTerm(data: ScrapeJob): string | null {
  if (data.seller_handle && data.seller_handle.trim().length >= MIN_TERM_LENGTH) {
    return data.seller_handle.replace(/^@/, "").trim();
  }
  // For non-marketplace URLs (dropshipper sites etc.) the domain itself is
  // worth searching — DTI advisories name some scam domains directly.
  if (!data.marketplace) {
    const domain = extractDomain(data.target_url);
    if (domain && domain.length >= MIN_TERM_LENGTH) return domain;
  }
  return null;
}

async function fetchSearchHtml(term: string): Promise<string | null> {
  const url = `${DTI_SEARCH_URL}?s=${encodeURIComponent(term)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
      timeoutMs: TIMEOUT_MS,
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(`[dti] HTTP ${res.status} for term="${term}"`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[dti] fetch failed for term="${term}": ${(err as Error).message}`);
    return null;
  }
}

interface ParsedResult {
  title: string;
  url: string;
}

// Extracts post/article entries from DTI's WordPress search results page.
// WordPress themes render search results as <article> blocks with the post
// title in an <h2> or <h3> linking to the permalink. We match that pattern
// rather than every <a> tag to avoid pulling header nav links and sidebars.
function parseSearchResults(html: string): ParsedResult[] {
  const results: ParsedResult[] = [];

  // <article>...<h2 ...><a href="..." ...>Title</a></h2>...</article>
  // Permissive on heading level (h1-h4) and on intervening attributes; tight
  // enough to require an <article> wrapper so we don't catch unrelated links.
  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  const titleLinkRe = /<h[1-4]\b[^>]*>\s*<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h[1-4]>/i;

  let m: RegExpExecArray | null;
  while ((m = articleRe.exec(html)) !== null) {
    const tm = m[1].match(titleLinkRe);
    if (!tm) continue;
    const url = tm[1].trim();
    const title = stripHtml(tm[2]).trim();
    if (!title || !url) continue;
    results.push({ title, url });
  }

  return results;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

// Same word-AND matcher pattern as reddit.ts. Multi-word handles ("dreame
// official store") match titles mentioning the brand alone ("Dreame Official
// Store closure order").
function buildMatcher(term: string): (text: string) => boolean {
  const words = term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return () => false;
  return (text: string) => {
    const lower = text.toLowerCase();
    return words.every((w) => lower.includes(w));
  };
}
