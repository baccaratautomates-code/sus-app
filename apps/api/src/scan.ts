import { randomUUID } from "node:crypto";
import type { ScanRequest, ScanResponse, Source } from "@sus/shared";
import { getCachedVerdict, setCachedVerdict } from "./cache";
import { fanOutScrapers } from "./queue";
import { flattenSignals, synthesizeVerdict } from "./synthesis";

const SCRAPER_TIMEOUT_MS = 25_000;
const MIN_SOURCE_COVERAGE = 3;

function cacheTarget(req: ScanRequest): string {
  if (req.kind === "url") return req.url ?? "";
  return `image:${req.image_id ?? ""}`;
}

function notEnoughInfo(req: ScanRequest, sources: Source[]): ScanResponse {
  return {
    trust_score: 0,
    verdict: "Not Enough Info",
    summary:
      "We couldn't find enough independent signals about this seller or product to make a confident judgment. Treat it with caution and look for more reviews before purchasing.",
    red_flags: [],
    green_flags: [],
    confidence: "Low",
    sources,
    scanned_at: new Date().toISOString(),
    input: req,
  };
}

export async function runScan(req: ScanRequest): Promise<ScanResponse> {
  const target = cacheTarget(req);

  // 1. Cache check (Redis, 7-day TTL).
  const cached = await getCachedVerdict(target);
  if (cached) return cached;

  // 2. Fan out to scraper workers via BullMQ; wait up to 25s.
  const scanId = randomUUID();
  const results = await fanOutScrapers(scanId, target, SCRAPER_TIMEOUT_MS);

  // 3. Insufficient data → "Not Enough Info". Never default to Looks Legit.
  const { sources } = flattenSignals(results);
  const distinctSourceUrls = new Set(sources.map((s) => s.url)).size;
  if (distinctSourceUrls < MIN_SOURCE_COVERAGE) {
    const response = notEnoughInfo(req, sources);
    await setCachedVerdict(target, response);
    return response;
  }

  // 4. Synthesis via Claude Haiku.
  const synth = await synthesizeVerdict(target, results);

  // 5. Defense-in-depth: if the model emitted "Looks Legit" despite thin coverage, downgrade.
  if (synth.verdict === "Looks Legit" && distinctSourceUrls < MIN_SOURCE_COVERAGE) {
    synth.verdict = "Not Enough Info";
    synth.confidence = "Low";
  }

  const response: ScanResponse = {
    ...synth,
    scanned_at: new Date().toISOString(),
    input: req,
  };

  await setCachedVerdict(target, response);
  return response;
}
