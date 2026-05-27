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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recent-scans queries are always user-scoped + time-ordered.
CREATE INDEX IF NOT EXISTS scans_user_created_idx
  ON scans (user_id, created_at DESC);
