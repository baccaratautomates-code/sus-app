import { env } from "./env";
import { sql } from "./db";

// PRD §6.4: free users get 3 scans/month, Pro is unlimited.
const FREE_QUOTA_PER_MONTH = 3;

// User IDs that skip the quota gate entirely. Always includes the "test-user"
// stub used by local seed scripts, then merges in anything configured via the
// BYPASS_USER_IDS env var (comma-separated Supabase user UUIDs) — that's the
// production path for demo/test accounts that need unlimited scans without
// flipping is_pro = true in the DB (which would later collide with
// RevenueCat webhook state).
const QUOTA_BYPASS_USERS = new Set<string>([
  "test-user",
  ...env.BYPASS_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
]);

export interface QuotaStatus {
  allowed: boolean;
  isPro: boolean;
  scansUsed: number;
  /** Infinity for Pro; remaining free scans for non-Pro. */
  scansRemaining: number;
  reason?: string;
}

/**
 * Reads the user's quota state, resetting the monthly counter if the month
 * rolled over since `last_reset_at`. Does NOT consume the quota — call
 * {@link consumeQuota} after a successful scan so failed scans don't burn it.
 *
 * Creates the user row if missing so first-time scanners get a clean slate.
 */
export async function checkQuota(userId: string): Promise<QuotaStatus> {
  if (QUOTA_BYPASS_USERS.has(userId)) {
    return {
      allowed: true,
      isPro: false,
      scansUsed: 0,
      scansRemaining: Number.POSITIVE_INFINITY,
    };
  }

  await sql`
    INSERT INTO users (id) VALUES (${userId})
    ON CONFLICT (id) DO NOTHING
  `;

  // Reset the monthly counter if last_reset_at predates the current UTC month.
  await sql`
    UPDATE users
    SET scans_this_month = 0,
        last_reset_at = date_trunc('month', now() AT TIME ZONE 'UTC')
    WHERE id = ${userId}
      AND last_reset_at < date_trunc('month', now() AT TIME ZONE 'UTC')
  `;

  const rows = (await sql`
    SELECT is_pro, scans_this_month FROM users WHERE id = ${userId}
  `) as Array<{ is_pro: boolean; scans_this_month: number }>;

  if (rows.length === 0) {
    throw new Error(`user ${userId} not found after upsert`);
  }

  const { is_pro, scans_this_month } = rows[0];

  if (is_pro) {
    return {
      allowed: true,
      isPro: true,
      scansUsed: scans_this_month,
      scansRemaining: Number.POSITIVE_INFINITY,
    };
  }

  if (scans_this_month >= FREE_QUOTA_PER_MONTH) {
    return {
      allowed: false,
      isPro: false,
      scansUsed: scans_this_month,
      scansRemaining: 0,
      reason: `Free quota of ${FREE_QUOTA_PER_MONTH} scans/month exceeded. Upgrade to Pro for unlimited scans.`,
    };
  }

  return {
    allowed: true,
    isPro: false,
    scansUsed: scans_this_month,
    scansRemaining: FREE_QUOTA_PER_MONTH - scans_this_month,
  };
}

/**
 * Increments the user's monthly scan counter. Call only after a scan
 * succeeds — failed scans should not count against the quota. No-op for
 * bypass users.
 */
export async function consumeQuota(userId: string): Promise<void> {
  if (QUOTA_BYPASS_USERS.has(userId)) return;
  await sql`
    UPDATE users
    SET scans_this_month = scans_this_month + 1
    WHERE id = ${userId}
  `;
}
