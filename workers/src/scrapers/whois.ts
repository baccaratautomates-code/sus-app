// @ts-expect-error — whois-json ships without bundled types
import whois from "whois-json";
import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";

const DOMAIN_RECENT_THRESHOLD_DAYS = 90;
const WHOIS_TIMEOUT_MS = 15_000;

const PRIVACY_PATTERNS = [
  /privacy/i,
  /redacted/i,
  /whoisguard/i,
  /domains by proxy/i,
  /perfect privacy/i,
  /contact privacy/i,
  /withheld for privacy/i,
  /data protected/i,
];

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

export async function whoisScraper({ id, data }: ScraperInput): Promise<ScrapeResult> {
  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(
      `[whois] could not extract domain from target_url="${data.target_url}" — empty result`,
    );
    return emptyResult(id);
  }

  console.log(`[whois] lookup start: ${domain}`);
  const startedAt = Date.now();

  let record: Record<string, unknown>;
  try {
    record = await whoisWithTimeout(domain);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[whois] lookup failed for ${domain}: ${message}`);
    return emptyResult(id);
  }

  const ageDays = parseAgeDays(record);
  const registrar = parseRegistrar(record);
  const privacyProtected = isPrivacyProtected(record);

  const source: Source = {
    url: `https://www.whois.com/whois/${domain}`,
    title: `WHOIS record for ${domain}`,
    signal_type: "domain",
  };

  const signals: Signal[] = [
    // Baseline — gives synthesis the raw data even when nothing is flagged.
    {
      type: "domain",
      weight: 0,
      detail: formatBaseline(domain, ageDays, registrar, privacyProtected),
      source,
    },
  ];

  if (ageDays !== null && ageDays < DOMAIN_RECENT_THRESHOLD_DAYS) {
    signals.push({
      type: "domain",
      weight: 0.8,
      detail: `Domain registered ${ageDays} days ago — recent registrations are a common counterfeit/scam signal.`,
      source,
    });
  }

  if (privacyProtected) {
    signals.push({
      type: "domain",
      weight: 0.4,
      detail: "WHOIS contact details are privacy-protected, hiding registrant identity.",
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[whois] lookup done: ${domain} age=${ageDays ?? "?"}d registrar="${registrar}" privacy=${privacyProtected} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "whois",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}

// Some TLDs / slow registrars can wedge the underlying WHOIS query. Cap it so a
// stuck lookup can't outlast the API's 25s scrape budget upstream.
async function whoisWithTimeout(domain: string): Promise<Record<string, unknown>> {
  return Promise.race([
    whois(domain) as Promise<Record<string, unknown>>,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`WHOIS lookup timeout after ${WHOIS_TIMEOUT_MS}ms`)),
        WHOIS_TIMEOUT_MS,
      ),
    ),
  ]);
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

// whois-json returns a flat object with camelCased keys derived from the raw WHOIS
// response. Field names vary by registry — check a handful of common ones.
function parseAgeDays(record: Record<string, unknown>): number | null {
  const created = firstString(record, [
    "creationDate",
    "createdDate",
    "created",
    "registered",
    "registrationTime",
    "domainRegistrationDate",
  ]);
  if (!created) return null;

  const createdMs = Date.parse(created);
  if (!Number.isFinite(createdMs)) return null;

  return Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000));
}

function parseRegistrar(record: Record<string, unknown>): string {
  return (
    firstString(record, ["registrar", "sponsoringRegistrar", "registrarName"]) ?? "unknown"
  );
}

function isPrivacyProtected(record: Record<string, unknown>): boolean {
  const candidates = [
    firstString(record, ["registrantName", "registrant", "registrantOrganization"]),
    firstString(record, ["registrantEmail"]),
    firstString(record, ["adminName", "adminEmail"]),
    firstString(record, ["techName", "techEmail"]),
  ].filter((v): v is string => typeof v === "string");

  return candidates.some((value) => PRIVACY_PATTERNS.some((re) => re.test(value)));
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function formatBaseline(
  domain: string,
  ageDays: number | null,
  registrar: string,
  privacyProtected: boolean,
): string {
  const ageStr = ageDays !== null ? `${ageDays} days` : "unknown";
  return `WHOIS for ${domain}: age ${ageStr}, registrar "${registrar}", privacy-protected: ${privacyProtected}`;
}

function emptyResult(id: string): ScrapeResult {
  return {
    source: "whois",
    job_id: id,
    signals: [],
    scraped_at: new Date().toISOString(),
  };
}
