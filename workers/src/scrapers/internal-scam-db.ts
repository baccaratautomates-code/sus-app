import type { ScrapeJob, ScrapeResult, Signal, Source } from "@sus/shared";
import { emptyResult, extractDomain } from "./_lib";

// Bun.sql is built-in (Bun 1.1.30+) and reads DATABASE_URL from env.
// No driver dep required — keeps the workers package lean.

interface ScraperInput {
  id: string;
  data: ScrapeJob;
}

// Assumed schema:
//   CREATE TABLE known_bad_domains (
//     domain      TEXT PRIMARY KEY,
//     reason      TEXT,
//     reported_at TIMESTAMPTZ DEFAULT now()
//   );
interface BadDomainRow {
  domain: string;
  reason?: string | null;
  reported_at?: Date | string | null;
}

export async function internalScamDbScraper({
  id,
  data,
}: ScraperInput): Promise<ScrapeResult> {
  if (!process.env.DATABASE_URL) {
    console.warn("[internal-scam-db] DATABASE_URL not set — empty result");
    return emptyResult("internal-scam-db", id);
  }

  const domain = extractDomain(data.target_url);
  if (!domain) {
    console.warn(`[internal-scam-db] no domain — empty result`);
    return emptyResult("internal-scam-db", id);
  }

  console.log(`[internal-scam-db] lookup start: ${domain}`);
  const startedAt = Date.now();

  let row: BadDomainRow | undefined;
  try {
    const rows = (await Bun.sql`
      SELECT domain, reason, reported_at
      FROM known_bad_domains
      WHERE domain = ${domain}
      LIMIT 1
    `) as BadDomainRow[];
    row = rows[0];
  } catch (err) {
    console.error(
      `[internal-scam-db] query failed for ${domain}: ${(err as Error).message}`,
    );
    return emptyResult("internal-scam-db", id);
  }

  const source: Source = {
    url: `https://sus.app/internal/scam-db/${encodeURIComponent(domain)}`,
    title: `Sus internal scam DB record for ${domain}`,
    signal_type: "internal_scam_db",
  };

  const signals: Signal[] = [
    {
      type: "internal_scam_db",
      weight: 0,
      detail: row
        ? `Domain "${domain}" found in Sus internal scam DB.`
        : `Domain "${domain}" not found in Sus internal scam DB.`,
      source,
    },
  ];

  if (row) {
    const reportedAt = row.reported_at
      ? ` (reported ${new Date(row.reported_at).toISOString().slice(0, 10)})`
      : "";
    const reason = row.reason ? ` — reason: ${row.reason}` : "";
    signals.push({
      type: "internal_scam_db",
      weight: 1.0,
      detail: `Sus internal scam DB flags "${domain}"${reason}${reportedAt}.`,
      source,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[internal-scam-db] lookup done: ${domain} hit=${row ? "yes" : "no"} signals=${signals.length} (${elapsedMs}ms)`,
  );

  return {
    source: "internal-scam-db",
    job_id: id,
    signals,
    scraped_at: new Date().toISOString(),
  };
}
