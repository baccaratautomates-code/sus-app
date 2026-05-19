import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";

const API_URL = "https://api.scamadviser.com/v2/info";
const API_TIMEOUT_MS = 10_000;
const LOW_TRUST_THRESHOLD = 50;

interface ScamadviserResponse {
  trust_score?: number;
  is_suspicious?: boolean;
  is_malware?: boolean;
  country_code?: string;
  website_age?: number | string;
}

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function scamadviserScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const apiKey = process.env.SCAMADVISER_API_KEY;
  if (!apiKey) {
    console.warn("[scamadviser] SCAMADVISER_API_KEY not set — returning empty result");
    return emptyResult(id);
  }

  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(
      `[scamadviser] could not extract domain from target_url="${data.target_url}" — empty result`,
    );
    return emptyResult(id);
  }

  console.log(`[scamadviser] lookup start: ${domain}`);
  const startedAt = Date.now();

  let body: ScamadviserResponse;
  try {
    body = await fetchScamadviser(domain, apiKey);
  } catch (err) {
    console.error(
      `[scamadviser] lookup failed for ${domain}: ${(err as Error).message}`,
    );
    return emptyResult(id);
  }

  const source: Source = {
    url: `https://www.scamadviser.com/check-website/${domain}`,
    title: `Scamadviser report for ${domain}`,
    signal_type: "seller_reputation",
  };

  const signals: Signal[] = [
    // Baseline — gives synthesis the raw data even when nothing is flagged.
    {
      type: "seller_reputation",
      weight: 0,
      detail: formatBaseline(domain, body),
      source,
    },
  ];

  if (typeof body.trust_score === "number" && body.trust_score < LOW_TRUST_THRESHOLD) {
    signals.push({
      type: "seller_reputation",
      weight: 0.8,
      detail: `Scamadviser trust score is ${body.trust_score}/100 — below the ${LOW_TRUST_THRESHOLD} threshold.`,
      source,
    });
  }

  if (body.is_suspicious === true) {
    signals.push({
      type: "seller_reputation",
      weight: 0.9,
      detail: "Scamadviser flags this domain as suspicious.",
      source,
    });
  }

  if (body.is_malware === true) {
    signals.push({
      type: "seller_reputation",
      weight: 1.0,
      detail: "Scamadviser flags this domain for malware.",
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[scamadviser] lookup done: ${domain} trust=${body.trust_score ?? "?"} suspicious=${body.is_suspicious ?? "?"} malware=${body.is_malware ?? "?"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "scamadviser",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

async function fetchScamadviser(
  domain: string,
  apiKey: string,
): Promise<ScamadviserResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const url = `${API_URL}?domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ScamadviserResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractDomain(input: string): string | null {
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const parsed = new URL(withScheme);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function formatBaseline(domain: string, body: ScamadviserResponse): string {
  const parts = [`Scamadviser report for ${domain}`];
  if (typeof body.trust_score === "number") {
    parts.push(`trust score ${body.trust_score}/100`);
  }
  if (body.country_code) parts.push(`country ${body.country_code}`);
  if (body.website_age !== undefined && body.website_age !== null) {
    parts.push(`age ${body.website_age}`);
  }
  return parts.join(", ");
}

function emptyResult(id: string): ScrapeResult {
  return {
    source: "scamadviser",
    job_id: id,
    signals: [],
    scraped_at: new Date().toISOString(),
  };
}
