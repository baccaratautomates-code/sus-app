import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import type { ScrapeJob, ScrapeResult } from "@sus/shared";
import { env } from "./env";

// v1 scraper sources — see docs/sus-prd.md §3.2.
// Each scraper worker registers a job-name handler matching one of these.
export const SCRAPE_SOURCES = [
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

export type ScrapeSource = (typeof SCRAPE_SOURCES)[number];

// BullMQ requires maxRetriesPerRequest: null on connections used by Queue/QueueEvents/Worker.
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue<ScrapeJob, ScrapeResult>(env.WORKER_QUEUE_NAME, { connection });
const queueEvents = new QueueEvents(env.WORKER_QUEUE_NAME, { connection });

export async function fanOutScrapers(
  scanId: string,
  targetUrl: string,
  perJobTimeoutMs: number,
): Promise<ScrapeResult[]> {
  const jobs = await Promise.all(
    SCRAPE_SOURCES.map((source) =>
      queue.add(source, { scan_id: scanId, source, target_url: targetUrl }),
    ),
  );

  const settled = await Promise.allSettled(
    jobs.map((job) => job.waitUntilFinished(queueEvents, perJobTimeoutMs)),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<ScrapeResult> => r.status === "fulfilled")
    .map((r) => r.value);
}
