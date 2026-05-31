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
