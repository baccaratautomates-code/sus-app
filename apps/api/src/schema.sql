-- Phase 1 schema for Sus. Run automatically on API startup via db.ts.
-- Designed to be idempotent: re-running this file is a no-op on existing installs.
--
-- Out of scope for Phase 1: real auth (users.id is supplied by the client today),
-- watched_domains (Pro Watch feature), known_bad_domains (internal scam DB seed).
-- Those land in later phases.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  scans_this_month  INTEGER NOT NULL DEFAULT 0,
  -- Tracks the first-of-month UTC boundary the counter was last reset against.
  -- The API resets scans_this_month to 0 on the first scan of a new calendar month.
  last_reset_at     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now() AT TIME ZONE 'UTC'),
  -- Pro entitlement, driven by the RevenueCat webhook. PRD §6.4: free=3/mo, Pro=unlimited.
  is_pro            BOOLEAN NOT NULL DEFAULT false
);

-- Idempotent column add for installs that predate is_pro.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target        TEXT NOT NULL,
  verdict       TEXT NOT NULL,
  trust_score   INTEGER NOT NULL,
  -- Full ScanResponse object (verdict + summary + flags + sources + …).
  -- Kept as JSONB so we can extract fields later without schema migrations.
  response      JSONB NOT NULL,
  -- og:image URL captured at scan time so History rows can render a thumbnail
  -- of the actual product (every Shopee URL has the same favicon — a list of
  -- identical orange bags doesn't help the user remember which scan was which).
  -- Nullable: scrape can fail, page can lack og:image, or input may not be a URL.
  -- Mobile falls back to favicon → letter tile when null.
  thumbnail_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent column add for installs that predate thumbnail_url.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Recent-scans queries are always user-scoped + time-ordered.
CREATE INDEX IF NOT EXISTS scans_user_created_idx
  ON scans (user_id, created_at DESC);

-- PRD §6.4 Pro Watch feature. Each row is one URL the user is monitoring;
-- the cron re-runs the scan every ~24h and diffs the new verdict against
-- last_response. If the verdict downgrades (Looks Legit → Suspicious, any →
-- High Risk) or the trust score drops by ≥10, an alert is staged on the
-- watch row itself (pending_alert) and the mobile client surfaces it on the
-- Watch tab. One row per (user_id, target) — re-watching is a no-op.
CREATE TABLE IF NOT EXISTS watches (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Original URL that was scanned. Cron re-runs the scan against this exact
  -- target, going through the same normalize → cache → fan-out path as a
  -- fresh user-initiated scan.
  target            TEXT NOT NULL,
  -- Human-readable label for the Watch list UI (Shopee product name or URL).
  -- Captured at watch-creation time so the mobile client doesn't have to
  -- re-resolve it for the list view.
  label             TEXT NOT NULL,
  -- og:image at watch-creation time (same URL as scans.thumbnail_url).
  -- Refreshed when the watch is re-scanned.
  thumbnail_url     TEXT,
  -- Last known verdict + trust_score. The diff is computed against these.
  last_verdict      TEXT NOT NULL,
  last_trust_score  INTEGER NOT NULL,
  -- Full ScanResponse from the last check, used to diff red_flags/sources.
  last_response     JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the cron should next pick this watch up. The cron query is
  -- WHERE next_check_at <= now(), so bumping this to now()+24h after each
  -- check naturally rate-limits to once per day.
  next_check_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  -- Staged alert payload when the most recent re-check found a worse verdict.
  -- Null while everything's fine; populated with {old_verdict, new_verdict,
  -- old_score, new_score, summary} when the cron flags a downgrade. Cleared
  -- when the user views it in the mobile app.
  pending_alert     JSONB,
  alerted_at        TIMESTAMPTZ,
  UNIQUE (user_id, target)
);

CREATE INDEX IF NOT EXISTS watches_user_idx
  ON watches (user_id, created_at DESC);

-- Cron picks up rows due for re-check. WHERE-on-timestamp + LIMIT works
-- without an index up to ~10k rows, but this is cheap insurance.
CREATE INDEX IF NOT EXISTS watches_next_check_idx
  ON watches (next_check_at)
  WHERE pending_alert IS NULL;

ALTER TABLE watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS watches_select_own ON watches;
CREATE POLICY watches_select_own ON watches
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- Row-Level Security (defense in depth). The Supabase anon key lives in the
-- mobile JS bundle and is publicly readable; without these policies anyone
-- could lift it and `supabase.from('scans').select()` to dump the table.
--
-- The API connects via DATABASE_URL with a postgres-role direct connection
-- that BYPASSES RLS, so /scan, /me/scans, /me/quota keep working unchanged.
-- These policies only gate queries that arrive through Supabase's REST API
-- (PostgREST) carrying an end-user JWT.
--
-- INSERT/UPDATE/DELETE intentionally have no anon policy — only the API can
-- mutate, because the API enforces business rules (a client-side UPDATE on
-- users would let anyone set is_pro=true and skip the paywall).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

-- DROP+CREATE so re-running the bootstrap is idempotent (CREATE POLICY alone
-- isn't — it errors if the policy already exists).
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id);

DROP POLICY IF EXISTS scans_select_own ON scans;
CREATE POLICY scans_select_own ON scans
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);
