import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import type { Marketplace, NormalizedInput, ScrapeJob, ScrapeResult } from "@sus/shared";
import { env } from "./env";

// v1 scraper sources — see docs/sus-prd.md §3.2.
// Each scraper worker registers a job-name handler matching one of these.
//
// Marketplace-aware scrapers (shopee-seller, shopee-listing, …) only run when
// the normalized input identifies them — they're gated below by MARKETPLACE_SCRAPERS.
export const SCRAPE_SOURCES = [
  "trustpilot",
  "scamadviser",
  "reddit",
  "whois",
  "wayback",
  "price-sanity",
  "review-authenticity",
  "internal-scam-db",
  "news",
  // Marketplace-aware (conditionally enqueued)
  "shopee-seller",
  "shopee-listing",
  "lazada-product",
  "tiktok-shop",
  "temu-listing",
  "facebook-page",
  "instagram-profile",
] as const;

// Which sources run only when the URL matches a specific marketplace. Sources
// not in this map run for every scan. The keys are scraper names; the values
// are the marketplace this scraper applies to.
const MARKETPLACE_SCRAPERS: Partial<Record<(typeof SCRAPE_SOURCES)[number], Marketplace>> = {
  "shopee-seller": "shopee-ph",
  "shopee-listing": "shopee-ph",
  "lazada-product": "lazada-ph",
  "tiktok-shop": "tiktok-shop",
  "temu-listing": "temu",
  "facebook-page": "facebook",
  "instagram-profile": "instagram",
};

export type ScrapeSource = (typeof SCRAPE_SOURCES)[number];

// BullMQ requires maxRetriesPerRequest: null on connections used by Queue/QueueEvents/Worker.
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue<ScrapeJob, ScrapeResult>(env.WORKER_QUEUE_NAME, { connection });
const queueEvents = new QueueEvents(env.WORKER_QUEUE_NAME, { connection });

export async function fanOutScrapers(
  scanId: string,
  targetUrl: string,
  perJobTimeoutMs: number,
  normalized: NormalizedInput | null,
): Promise<ScrapeResult[]> {
  // Pick sources: always-on + marketplace-gated ones that match this URL.
  const activeSources = SCRAPE_SOURCES.filter((source) => {
    const requiredMarketplace = MARKETPLACE_SCRAPERS[source];
    if (!requiredMarketplace) return true; // always-on scraper
    return normalized?.marketplace === requiredMarketplace;
  });

  console.log(
    `[queue] fan-out scan=${scanId} target=${targetUrl} marketplace=${normalized?.marketplace ?? "none"} redis=${env.REDIS_URL} queue="${env.WORKER_QUEUE_NAME}"`,
  );
  console.log(
    `[queue] enqueueing ${activeSources.length} jobs: ${activeSources.join(", ")}`,
  );

  const baseJob = {
    scan_id: scanId,
    target_url: targetUrl,
    domain: normalized?.domain ?? "",
    marketplace: normalized?.marketplace ?? null,
    shop_id: normalized?.shop_id ?? null,
    item_id: normalized?.item_id ?? null,
  };

  const jobs = await Promise.all(
    activeSources.map((source) =>
      queue.add(source, { ...baseJob, source }),
    ),
  );

  console.log(
    `[queue] enqueued: ${jobs.map((j) => `${j.name}#${j.id}`).join(", ")}`,
  );

  const settled = await Promise.allSettled(
    jobs.map((job) => job.waitUntilFinished(queueEvents, perJobTimeoutMs)),
  );

  const succeeded = settled.filter((r) => r.status === "fulfilled").length;
  const failed = settled.length - succeeded;
  console.log(`[queue] fan-out complete scan=${scanId} succeeded=${succeeded} failed=${failed}`);

  return settled
    .filter((r): r is PromiseFulfilledResult<ScrapeResult> => r.status === "fulfilled")
    .map((r) => r.value);
}
