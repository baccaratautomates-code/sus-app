import { Worker, Queue } from "bullmq";
import type { ScrapeJob, ScrapeResult } from "@sus/shared";

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const scrapeQueue = new Queue<ScrapeJob>("sus.scrape", { connection });

// One worker entry per signal source. Each is isolated and independently testable.
// See PRD §3.2 for the full source list.
const sources = [
  "trustpilot",
  "scamadviser",
  "reddit",
  "dti-ph",
  "whois",
  "price-sanity",
  "review-authenticity",
  "internal-scam-db",
  "news",
] as const;

for (const source of sources) {
  new Worker<ScrapeJob, ScrapeResult>(
    `sus.scrape.${source}`,
    async (job) => {
      // TODO: implement per-source scraping
      return {
        source,
        job_id: job.id ?? "",
        signals: [],
        scraped_at: new Date().toISOString(),
      };
    },
    { connection },
  );
}

console.log(`[workers] registered ${sources.length} scraper workers`);
