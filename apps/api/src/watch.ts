import type { ScanResponse, Verdict } from "@sus/shared";
import { sql } from "./db";
import { normalizeInput } from "./normalize";
import { runScan } from "./scan";

// PRD §6.4 Watch feature — periodic re-checks of saved listings with alerts
// on verdict downgrade. The cron runs every hour, picks up watches due for
// re-check (next_check_at <= now()), re-runs the original scan, diffs the new
// verdict against the stored last_response, and stages a pending_alert when
// the new verdict is materially worse than the old one.
//
// Cost note: re-checks call runScan() directly, bypassing /scan's quota gate.
// That's intentional — the user already paid for Pro; we don't double-charge
// quota for automatic re-checks. Cache hits in runScan keep the cost down
// (~7-day TTL on the Redis verdict cache), so most re-checks won't burn a
// full scrape fan-out.

const CRON_INTERVAL_MS = 60 * 60 * 1000;     // 1 hour
const NEXT_CHECK_DELAY_HOURS = 24;            // bump next_check_at by 24h after each check
const TRUST_SCORE_DROP_THRESHOLD = 10;        // ≥10 point drop = alert-worthy
const BATCH_SIZE = 25;                        // watches processed per tick

// Verdict labels ordered from BEST to WORST. An index increase = a worse
// verdict. Used to determine whether a re-check downgraded the assessment.
//
// "Not Enough Info" sits between Looks Legit and Suspicious deliberately:
// going from "Looks Legit" to "Not Enough Info" IS a downgrade worth alerting
// on (the previously-trusted signals disappeared); going from "Suspicious"
// to "Not Enough Info" is not (the seller didn't get safer, we just lost data).
const VERDICT_ORDER: readonly Verdict[] = [
  "Looks Legit",
  "Not Enough Info",
  "Suspicious",
  "High Risk",
];

function verdictRank(v: Verdict): number {
  const i = VERDICT_ORDER.indexOf(v);
  return i === -1 ? 1 : i; // unknown verdicts treated as Not Enough Info
}

interface WatchRow {
  id: string;
  user_id: string;
  target: string;
  last_verdict: Verdict;
  last_trust_score: number;
  last_response: unknown;
}

interface PendingAlert {
  old_verdict: Verdict;
  new_verdict: Verdict;
  old_trust_score: number;
  new_trust_score: number;
  new_red_flags: string[];           // red flags that appeared in the new check
  summary: string;                    // short one-line description for push body
  checked_at: string;
}

// Diffs the new ScanResponse against the watch's stored state and returns
// an alert payload IF the change is bad enough to surface to the user.
// Returns null when nothing material changed — those checks update
// last_checked_at + next_check_at silently.
function buildAlertIfDowngrade(
  watch: WatchRow,
  next: ScanResponse,
  checkedAt: Date,
): PendingAlert | null {
  const oldRank = verdictRank(watch.last_verdict);
  const newRank = verdictRank(next.verdict);
  const scoreDrop = watch.last_trust_score - next.trust_score;

  // Compute new red flags — claims the previous check didn't make. The
  // diff is on string equality; LLM-generated red_flag text is stable
  // enough at temperature 0 that exact-match works.
  const oldResponse = (typeof watch.last_response === "string"
    ? JSON.parse(watch.last_response)
    : watch.last_response) as ScanResponse | null;
  const oldFlags = new Set(oldResponse?.red_flags ?? []);
  const newRedFlags = (next.red_flags ?? []).filter((f) => !oldFlags.has(f));

  // Alert triggers, in priority order:
  //   1. Verdict downgrade (e.g. Looks Legit → Suspicious / High Risk)
  //   2. Trust score dropped ≥ 10 points (signals shifted negative)
  //   3. New red flags appeared without a verdict change (rare but worth surfacing)
  let summary: string;
  if (newRank > oldRank) {
    summary = `Verdict on this listing changed: ${watch.last_verdict} → ${next.verdict}.`;
  } else if (scoreDrop >= TRUST_SCORE_DROP_THRESHOLD) {
    summary = `Trust score dropped ${scoreDrop} points (${watch.last_trust_score} → ${next.trust_score}).`;
  } else if (newRedFlags.length > 0 && newRank >= oldRank) {
    summary = `${newRedFlags.length} new red flag${newRedFlags.length === 1 ? "" : "s"} found on this listing.`;
  } else {
    return null;
  }

  return {
    old_verdict: watch.last_verdict,
    new_verdict: next.verdict,
    old_trust_score: watch.last_trust_score,
    new_trust_score: next.trust_score,
    new_red_flags: newRedFlags,
    summary,
    checked_at: checkedAt.toISOString(),
  };
}

// One tick of the cron — fetches up to BATCH_SIZE due watches and re-checks
// each one. Errors on individual watches are logged and skipped; we don't
// want a single bad URL to block the rest of the batch.
async function processBatch(): Promise<void> {
  let due: WatchRow[];
  try {
    due = (await sql`
      SELECT id, user_id, target, last_verdict, last_trust_score, last_response
      FROM watches
      WHERE next_check_at <= now()
        AND pending_alert IS NULL
      ORDER BY next_check_at ASC
      LIMIT ${BATCH_SIZE}
    `) as WatchRow[];
  } catch (err) {
    console.error(`[watch] batch query failed: ${(err as Error).message}`);
    return;
  }

  if (due.length === 0) return;
  console.log(`[watch] processing ${due.length} due watch(es)`);

  for (const watch of due) {
    const checkedAt = new Date();
    let next: ScanResponse;
    try {
      // runScan re-uses the same fan-out + cache path as a fresh user scan.
      // It also re-normalizes the URL so marketplace context is preserved.
      next = await runScan({
        kind: "url",
        url: watch.target,
        user_id: watch.user_id,
      });
    } catch (err) {
      console.error(
        `[watch] re-scan failed user=${watch.user_id} target=${watch.target}: ${(err as Error).message} — bumping next_check_at and skipping`,
      );
      try {
        await sql`
          UPDATE watches
          SET last_checked_at = ${checkedAt.toISOString()},
              next_check_at = ${nextCheckAt().toISOString()}
          WHERE id = ${watch.id}
        `;
      } catch (err2) {
        console.error(`[watch] failed to bump next_check_at: ${(err2 as Error).message}`);
      }
      continue;
    }

    const alert = buildAlertIfDowngrade(watch, next, checkedAt);

    try {
      if (alert) {
        // Verdict got worse — stage the alert AND update last_* to the new
        // state so subsequent checks compare against the NEW baseline. That
        // way a single sustained downgrade only fires once, not every day.
        const normalized = normalizeInput(watch.target);
        const thumbnailUrl = next.thumbnail_url ?? null;
        await sql`
          UPDATE watches
          SET last_verdict = ${next.verdict},
              last_trust_score = ${next.trust_score},
              last_response = ${JSON.stringify(next)}::jsonb,
              thumbnail_url = COALESCE(${thumbnailUrl}, thumbnail_url),
              label = ${humanLabel(watch.target, normalized?.seller_handle ?? null)},
              last_checked_at = ${checkedAt.toISOString()},
              next_check_at = ${nextCheckAt().toISOString()},
              pending_alert = ${JSON.stringify(alert)}::jsonb,
              alerted_at = ${checkedAt.toISOString()}
          WHERE id = ${watch.id}
        `;
        console.warn(
          `[watch] ALERT user=${watch.user_id} target=${watch.target}: ${alert.summary}`,
        );
      } else {
        // Nothing material changed — refresh last_* (in case score nudged
        // within tolerance), bump next_check_at, no alert.
        await sql`
          UPDATE watches
          SET last_verdict = ${next.verdict},
              last_trust_score = ${next.trust_score},
              last_response = ${JSON.stringify(next)}::jsonb,
              last_checked_at = ${checkedAt.toISOString()},
              next_check_at = ${nextCheckAt().toISOString()}
          WHERE id = ${watch.id}
        `;
      }
    } catch (err) {
      console.error(
        `[watch] update failed user=${watch.user_id} id=${watch.id}: ${(err as Error).message}`,
      );
    }
  }
}

function nextCheckAt(): Date {
  return new Date(Date.now() + NEXT_CHECK_DELAY_HOURS * 60 * 60 * 1000);
}

// Best-effort label refresh on alerts. We don't re-resolve product names
// (that'd cost an extra HTTP request); just use the seller handle when
// available, else the target URL as-is.
function humanLabel(target: string, sellerHandle: string | null): string {
  if (sellerHandle) {
    // Title-case the slug so "dreame official store" → "Dreame Official Store"
    return sellerHandle
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return target;
}

let cronTimer: ReturnType<typeof setInterval> | null = null;

// Starts the watch-check cron. Called once at API startup. Safe to call
// multiple times — the timer is singleton-guarded.
export function startWatchCron(): void {
  if (cronTimer) return;
  console.log(`[watch] cron starting — interval ${CRON_INTERVAL_MS / 1000}s, batch ${BATCH_SIZE}`);

  // Fire once at startup so newly-deployed instances pick up overdue watches
  // immediately instead of waiting up to an hour. Defer slightly so the API
  // is fully listening before we hammer the DB.
  setTimeout(() => {
    processBatch().catch((err) =>
      console.error(`[watch] initial batch failed: ${(err as Error).message}`),
    );
  }, 30_000);

  cronTimer = setInterval(() => {
    processBatch().catch((err) =>
      console.error(`[watch] batch failed: ${(err as Error).message}`),
    );
  }, CRON_INTERVAL_MS);
}

export function stopWatchCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
