console.log("REDIS_URL from env:", process.env.REDIS_URL);

import { config } from "dotenv";
config();

import { Worker } from "bullmq";
import IORedis from "ioredis";
import type { ScrapeJob, ScrapeResult } from "@sus/shared";
import { dtiScraper } from "./scrapers/dti";
import { facebookPageScraper } from "./scrapers/facebook-page";
import { instagramProfileScraper } from "./scrapers/instagram-profile";
import { internalScamDbScraper } from "./scrapers/internal-scam-db";
import { lazadaProductScraper } from "./scrapers/lazada-product";
import { newsScraper } from "./scrapers/news";
import { priceSanityScraper } from "./scrapers/price-sanity";
import { redditScraper } from "./scrapers/reddit";
import { reviewAuthenticityScraper } from "./scrapers/review-authenticity";
import { scamadviserScraper } from "./scrapers/scamadviser";
import { shopeeListingScraper } from "./scrapers/shopee-listing";
import { shopeeSellerScraper } from "./scrapers/shopee-seller";
import { temuListingScraper } from "./scrapers/temu-listing";
import { tiktokProductScraper } from "./scrapers/tiktok-product";
import { tiktokShopScraper } from "./scrapers/tiktok-shop";
import { trustpilotScraper } from "./scrapers/trustpilot";
import { waybackScraper } from "./scrapers/wayback";
import { whoisScraper } from "./scrapers/whois";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_NAME = process.env.WORKER_QUEUE_NAME ?? "scraper-queue";

console.log(`[workers] starting, queue="${QUEUE_NAME}", redis=${REDIS_URL}`);

// BullMQ requires maxRetriesPerRequest: null on Worker connections.
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

connection.on("connect", () => console.log("[workers] redis connected"));
connection.on("ready", () => console.log("[workers] redis ready"));
connection.on("error", (err) => console.error(`[workers] redis error: ${err.message}`));
connection.on("end", () => console.warn("[workers] redis connection closed"));
connection.on("reconnecting", () => console.warn("[workers] redis reconnecting…"));

// Job name → scraper. The API enqueues one job per source with the source string
// as the job name; this dispatcher routes to the matching scraper.
type ScraperFn = (input: { id: string; data: ScrapeJob }) => Promise<ScrapeResult>;

const SCRAPERS: Record<string, ScraperFn> = {
  dti: dtiScraper,
  "facebook-page": facebookPageScraper,
  "instagram-profile": instagramProfileScraper,
  "internal-scam-db": internalScamDbScraper,
  "lazada-product": lazadaProductScraper,
  news: newsScraper,
  "price-sanity": priceSanityScraper,
  reddit: redditScraper,
  "review-authenticity": reviewAuthenticityScraper,
  scamadviser: scamadviserScraper,
  "shopee-listing": shopeeListingScraper,
  "shopee-seller": shopeeSellerScraper,
  "temu-listing": temuListingScraper,
  "tiktok-product": tiktokProductScraper,
  "tiktok-shop": tiktokShopScraper,
  trustpilot: trustpilotScraper,
  wayback: waybackScraper,
  whois: whoisScraper,
};

const worker = new Worker<ScrapeJob, ScrapeResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(
      `[workers] job received: id=${job.id} name="${job.name}" target=${job.data.target_url}`,
    );

    const scraper = SCRAPERS[job.name];
    if (!scraper) {
      console.warn(
        `[workers] no scraper registered for "${job.name}" — returning empty result`,
      );
      return {
        source: job.name,
        job_id: job.id ?? "",
        signals: [],
        scraped_at: new Date().toISOString(),
      };
    }

    return scraper({ id: job.id ?? "", data: job.data });
  },
  { connection },
);

worker.on("ready", () =>
  console.log(
    `[workers] worker ready, handlers: ${Object.keys(SCRAPERS).join(", ") || "(none)"}`,
  ),
);
worker.on("active", (job) =>
  console.log(`[workers] job active: id=${job.id} name="${job.name}"`),
);
worker.on("completed", (job, result: ScrapeResult) => {
  const ms = job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : "?";
  console.log(
    `[workers] job completed: id=${job.id} name="${job.name}" signals=${result.signals.length} duration=${ms}ms`,
  );
});
worker.on("failed", (job, err) =>
  console.error(
    `[workers] job failed: id=${job?.id} name="${job?.name}" error=${err.message}`,
  ),
);
worker.on("error", (err) => console.error(`[workers] worker error: ${err.message}`));

async function shutdown(signal: string) {
  console.log(`[workers] received ${signal}, shutting down…`);
  try {
    await worker.close();
    await connection.quit();
  } catch (err) {
    console.error(`[workers] shutdown error: ${(err as Error).message}`);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
