import { randomUUID } from "node:crypto";
import type {
  NormalizedInput,
  ScanRequest,
  ScanResponse,
  Signal,
  Source,
} from "@sus/shared";
import { getCachedVerdict, setCachedVerdict } from "./cache";
import { sql } from "./db";
import { normalizeInput } from "./normalize";
import { fanOutScrapers } from "./queue";
import { flattenSignals, synthesizeVerdict } from "./synthesis";
import { fetchThumbnail } from "./thumbnail";

const SCRAPER_TIMEOUT_MS = 25_000;
const MIN_SOURCE_COVERAGE = 3;

// Structural platform-risk signals (FB Marketplace, IG shop) emit detail text
// matching this phrase. Used to detect the case where the only non-zero-weight
// evidence is "this is on a structurally risky platform" with nothing about the
// specific seller — that situation must NOT drive a Suspicious/High Risk verdict
// (PRD §5 defamation safety).
const STRUCTURAL_RISK_MARKER = /PRD §3\.2 flags/;

// Cache key for the 7-day Redis verdict cache. For marketplace URLs we key by
// (marketplace, shop_id[, item_id]) so two scans of the same Shopee listing
// hit the same entry regardless of how the URL was reached (paste, OCR of a
// screenshot, share-sheet). Otherwise we'd see drift like 95→85 because
// (a) the raw URL strings differ (query params, OCR truncation) so each scan
// cache-misses, (b) the live Shopee follower count moves between scrapes,
// (c) Groq inference isn't bit-deterministic even at temperature 0. The URL
// itself is still used as the scrape input and the History-row label — only
// the cache lookup key changes.
function canonicalCacheKey(
  req: ScanRequest,
  normalized: NormalizedInput | null,
): string {
  if (normalized?.marketplace && normalized.shop_id) {
    return normalized.item_id
      ? `${normalized.marketplace}:${normalized.shop_id}:${normalized.item_id}`
      : `${normalized.marketplace}:${normalized.shop_id}`;
  }
  if (req.kind === "url") return req.url ?? "";
  return `image:${req.image_id ?? ""}`;
}

function notEnoughInfo(req: ScanRequest, sources: Source[]): ScanResponse {
  return {
    trust_score: 0,
    verdict: "Not Enough Info",
    summary:
      "Public signals on this seller are too thin to call. Fewer than three independent sources had anything to say about them — not necessarily a bad sign, but not enough to vouch for them either. Message the seller first and read the reviews on the listing page itself before paying.",
    red_flags: [],
    green_flags: [],
    confidence: "Low",
    sources,
    scanned_at: new Date().toISOString(),
    input: req,
  };
}

export async function runScan(req: ScanRequest): Promise<ScanResponse> {
  console.log(`[scan] runScan kind=${req.kind} user=${req.user_id}`);

  // 1. Input normalization (PRD §3.1). Moved BEFORE the cache check so the
  //    cache key can be canonical — same shop_id+item_id across paste vs OCR
  //    vs share-sheet maps to one entry.
  const normalized = req.kind === "url" ? normalizeInput(req.url ?? "") : null;
  if (normalized) {
    console.log(
      `[scan] normalized: domain=${normalized.domain} marketplace=${normalized.marketplace ?? "none"} shop_id=${normalized.shop_id ?? "?"} item_id=${normalized.item_id ?? "?"}`,
    );
  }

  // `target` is the URL the scrapers and synthesis prompt see (and what gets
  // stored as the History row label). `cacheKey` is the dedupe identity for
  // Redis — usually identical, but for marketplace URLs they diverge so query
  // params and OCR truncation don't cause cache misses.
  const target = req.kind === "url" ? (req.url ?? "") : `image:${req.image_id ?? ""}`;
  const cacheKey = canonicalCacheKey(req, normalized);
  if (cacheKey !== target) {
    console.log(`[scan] cache key canonicalized: ${target} → ${cacheKey}`);
  }

  // Kick off thumbnail fetch in parallel with everything else. Marketplace
  // path (Shopee API) when normalized has shop_id+item_id, otherwise og:image
  // scrape. Thumbnail is History UI candy — not critical to the verdict — so
  // we don't await it until persistScan time. On cache misses it parallelizes
  // with the 25s scrape so it's free; on cache hits we pay up to ~2.5s
  // before persisting.
  const thumbnailPromise = req.kind === "url"
    ? fetchThumbnail(target, normalized)
    : Promise.resolve(null);

  // 2. Cache check (Redis, 7-day TTL). Cache hits still get persisted as a scan
  //    for this user so their recent-history reflects what they actually checked.
  const cached = await getCachedVerdict(cacheKey);
  if (cached) {
    console.log(`[scan] cache HIT key=${cacheKey} verdict="${cached.verdict}" — skipping fan-out`);
    const thumbnailUrl = await thumbnailPromise;
    // Re-attach the thumbnail to the response we return. Prefer the freshly-fetched
    // value (in case the product image was updated or we couldn't get one when the
    // entry was first cached); fall back to whatever was cached.
    const enriched: ScanResponse = {
      ...cached,
      thumbnail_url: thumbnailUrl ?? cached.thumbnail_url ?? null,
    };
    await persistScan(req, target, enriched, enriched.thumbnail_url ?? null);
    return enriched;
  }
  console.log(`[scan] cache MISS key=${cacheKey} — proceeding to fan-out`);

  // 3. Fan out to scraper workers via BullMQ; wait up to 25s.
  const scanId = randomUUID();
  console.log(`[scan] calling fanOutScrapers scan=${scanId} timeout=${SCRAPER_TIMEOUT_MS}ms`);
  const results = await fanOutScrapers(scanId, target, SCRAPER_TIMEOUT_MS, normalized);

  // 3. Insufficient data → "Not Enough Info". Never default to Looks Legit.
  const { signals, sources } = flattenSignals(results);
  const distinctSourceUrls = new Set(sources.map((s) => s.url)).size;
  if (distinctSourceUrls < MIN_SOURCE_COVERAGE) {
    const thumbnailUrl = await thumbnailPromise;
    const response: ScanResponse = { ...notEnoughInfo(req, sources), thumbnail_url: thumbnailUrl };
    await setCachedVerdict(cacheKey, response);
    await persistScan(req, target, response, thumbnailUrl);
    return response;
  }

  // 3a. Structural-only guard (PRD §5 defamation safety). If the only non-zero
  //     weight signal is "this seller is on a structurally risky platform" (FB
  //     Marketplace / IG shop), we cannot justify Suspicious/High Risk — we have
  //     no evidence about THIS seller specifically. Return Not Enough Info with
  //     the platform risk surfaced as a caveat in the summary.
  if (isStructuralRiskOnly(signals)) {
    console.warn(
      `[scan] structural-risk-only signals — downgrading to Not Enough Info (PRD §5)`,
    );
    const caveat = signals.find((s) => STRUCTURAL_RISK_MARKER.test(s.detail))?.detail ?? "";
    const thumbnailUrl = await thumbnailPromise;
    const response: ScanResponse = {
      trust_score: 0,
      verdict: "Not Enough Info",
      summary: `Nothing specific about this seller turned up — only the platform-level caveat. ${caveat} If you're going ahead, check their profile age and DM them first; for in-person trades, prefer cash-on-delivery.`,
      red_flags: [],
      green_flags: [],
      confidence: "Low",
      sources,
      scanned_at: new Date().toISOString(),
      input: req,
      thumbnail_url: thumbnailUrl,
    };
    await setCachedVerdict(cacheKey, response);
    await persistScan(req, target, response, thumbnailUrl);
    return response;
  }

  // 4. Synthesis via Groq (llama-3.1-8b-instant).
  const synth = await synthesizeVerdict(target, results, normalized);

  // 5. Defense-in-depth: catch the two combinations that are legally unsafe
  //    or internally contradictory regardless of what the model emitted.
  //
  //    (a) "Looks Legit" on thin coverage — PRD §3.4 forbids this exact case
  //        because the cost of being wrong is real money lost to a scam.
  if (synth.verdict === "Looks Legit" && distinctSourceUrls < MIN_SOURCE_COVERAGE) {
    console.warn(
      `[scan] downgrading Looks Legit -> Not Enough Info (only ${distinctSourceUrls} sources)`,
    );
    synth.verdict = "Not Enough Info";
    synth.confidence = "Low";
  }

  //    (b) "High Risk" with Low confidence — internally contradictory and
  //        a defamation risk (PRD §5). If we don't have high confidence we
  //        cannot label a real business High Risk. Downgrade to "Not Enough Info"
  //        AND scrub all the user-facing claim text — keeping defamatory red_flag
  //        strings while changing the verdict label launders the same accusation.
  //        Real High Risk verdicts will pair with Medium or High confidence.
  if (synth.verdict === "High Risk" && synth.confidence === "Low") {
    console.warn(
      `[scan] downgrading High Risk(Low confidence) -> Not Enough Info — scrubbing flags + score (PRD §5 defamation safety)`,
    );
    synth.verdict = "Not Enough Info";
    synth.trust_score = 0;
    synth.red_flags = [];
    synth.green_flags = [];
    synth.summary =
      "Public evidence on this seller is too uncertain to support a confident judgment. Read the reviews on the listing directly, and message the seller before paying — that's the most useful signal you can get yourself.";
    // Sources stay — they show the user what we checked, even though we couldn't conclude.
  }

  const thumbnailUrl = await thumbnailPromise;
  const response: ScanResponse = {
    ...synth,
    scanned_at: new Date().toISOString(),
    input: req,
    thumbnail_url: thumbnailUrl,
  };

  await setCachedVerdict(cacheKey, response);
  await persistScan(req, target, response, thumbnailUrl);
  return response;
}

// Returns true when every non-zero-weight signal is a structural platform-risk
// caveat (FB Marketplace / IG shop default risk) with no specific evidence about
// this seller. In that case the verdict must NOT be Suspicious/High Risk — the
// platform's structural risk is not evidence against a specific human seller.
function isStructuralRiskOnly(signals: Signal[]): boolean {
  const nonZero = signals.filter((s) => s.weight !== 0);
  if (nonZero.length === 0) return false; // no leaning signals at all — let synthesis handle
  return nonZero.every((s) => STRUCTURAL_RISK_MARKER.test(s.detail));
}

// Upsert the user row, then insert a scan record. Persistence failure is logged
// but never blocks the user from seeing their verdict — the scan still returns.
// Exported so the /scan and /scan/image pre-check branches can persist
// unsupported-marketplace results to History without going through runScan().
//
// thumbnailUrl is the og:image (if any) — passed in by the caller so runScan
// can parallelize the fetch with the scrape, and the pre-check branches can
// fetch it before they early-return.
export async function persistScan(
  req: ScanRequest,
  target: string,
  response: ScanResponse,
  thumbnailUrl: string | null,
): Promise<void> {
  try {
    await sql`
      INSERT INTO users (id) VALUES (${req.user_id})
      ON CONFLICT (id) DO NOTHING
    `;
    // JSON.stringify + explicit ::jsonb cast — more portable than relying on
    // a driver-specific `sql.json()` helper that Bun.SQL may not expose.
    await sql`
      INSERT INTO scans (id, user_id, target, verdict, trust_score, response, thumbnail_url)
      VALUES (
        ${randomUUID()},
        ${req.user_id},
        ${target},
        ${response.verdict},
        ${response.trust_score},
        ${JSON.stringify(response)}::jsonb,
        ${thumbnailUrl}
      )
    `;
  } catch (err) {
    console.error(`[scan] persist failed user=${req.user_id} target=${target}: ${(err as Error).message}`);
  }
}
