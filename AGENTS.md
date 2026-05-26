# AGENTS.md — Sus (Product Trust Checker)

> This file onboards AI agents into the Sus codebase.
> For full product context, read `docs/sus-prd.md` first.
> This file describes **current reality** — what's actually built, how the repo is structured, and what's left.

---

## What Sus is

A mobile + web app that tells users in ~10 seconds whether a product or seller they're about to buy from is legit, suspicious, or high-risk. Users share a URL from TikTok Shop, Shopee, Facebook Marketplace, etc. Sus investigates in parallel and returns a structured verdict card.

Target markets: Philippines and United States.

---

## Monorepo structure

```
sus-app/
├── apps/
│   ├── api/          # Backend API — Bun + Hono, handles scan requests
│   └── mobile/       # React Native app — Android + Web (Expo)
├── packages/
│   └── shared/       # Shared types and utilities used by api and mobile
├── workers/          # Scraper worker pool — runs parallel signal collection
├── docs/
│   └── sus-prd.md    # Full product requirements document
├── AGENTS.md         # This file
├── CLAUDE.md         # Claude-specific instructions (read this too)
├── package.json      # Monorepo root (Bun workspaces)
└── bunfig.toml       # Bun config
```

---

## Package responsibilities

### `apps/api` — Backend API
- Entry: `src/index.ts`
- Handles: `/scan` endpoint, auth, rate limiting, paywall check, cache lookup
- Orchestrates: fan-out to scraper workers, synthesis, writing results to cache + DB
- Key files:
  - `src/scan.ts` — core scan request handler
  - `src/synthesis.ts` — calls Groq for AI verdict synthesis
  - `src/cache.ts` — Redis read/write, 7-day TTL
  - `src/queue.ts` — job queue for scraper fan-out
  - `src/env.ts` — environment variable validation

### `workers` — Scraper worker pool
- Entry: `src/index.ts`
- 8 scrapers, each isolated, run concurrently per scan request
- Scrapers:
  - `trustpilot.ts` — Trustpilot seller reputation
  - `scamadviser.ts` — Scamadviser domain/seller check
  - `reddit.ts` — Reddit mentions (r/scams, r/Flipping, PH subs)
  - `whois.ts` — Domain age, registrar, SSL signals
  - `price-sanity.ts` — Compare listed price vs market price
  - `review-authenticity.ts` — Fake review detection
  - `news.ts` — Recent news mentions, FTC/DTI actions
  - `internal-scam-db.ts` — Internal known-bad database
  - `_lib.ts` — Shared scraper utilities
- Target: all scrapers resolve within 25s p95

### `apps/mobile` — React Native app (Expo)
- Platforms: Android ✅, Web ✅, iOS ❌ (not yet)
- Entry: `App.tsx` / `index.js`
- Navigation: `src/navigation.ts`
- Screens:
  - `HomeScreen.tsx` — URL input, share sheet entry point
  - `LoadingScreen.tsx` — "Investigating…" with rotating status text
  - `VerdictScreen.tsx` — Verdict card (score, verdict, flags, sources)
  - `PaywallScreen.tsx` — Paywall UI (screen exists, billing NOT yet wired)
- Components:
  - `VerdictBadge.tsx` — Trust score badge component
- State: `src/store.ts`
- Theme: `src/theme.ts`

### `packages/shared`
- Shared TypeScript types and utility functions
- Used by both `apps/api` and `apps/mobile`
- Entry: `src/index.ts`

---

## Current tech stack (actual, not PRD)

| Layer | Technology |
|---|---|
| Runtime | Bun |
| API framework | Hono (inside apps/api) |
| AI synthesis | **Groq** (NOT Claude Haiku — PRD is outdated on this) |
| Caching | Redis, 7-day TTL |
| Mobile | React Native + Expo |
| Platforms shipped | Android, Web |
| Monorepo tooling | Bun workspaces |
| Language | TypeScript throughout |

---

## What is done ✅

- Full monorepo structure with Bun workspaces
- All 8 scraper workers, running in parallel
- AI synthesis via Groq returning structured JSON verdicts
- Redis caching (7-day TTL, cache-hit returns instantly)
- React Native mobile app on Android and Web
- Real verdicts returning in ~10 seconds (3x faster than 30s PRD target)
- Verdict card UI (VerdictScreen, VerdictBadge)
- Loading screen with rotating status messages
- Paywall screen UI

---

## What is NOT done yet ❌

- **Real payments** — PaywallScreen exists but RevenueCat / Google Play Billing is not wired
- **Legal disclaimer footer** — required on every verdict card before launch (see PRD §5)
- **Share verdict as image** — branded card export for viral loop (Pro feature)
- **iOS app** — not started; Android + Web first
- **iOS share sheet** — depends on iOS app
- **Scan counter enforcement** — free tier limit (3 scans/month) UI logic
- **Watch feature** — Pro-only periodic re-check with alerts
- **App Store / Play Store submission prep** — screenshots, listing copy, scam-language compliance

---

## Hard rules — never break these

1. **Never use the word "scam" as a verdict label.** Use "High Risk" instead. This is a legal requirement (defamation risk in both US and PH). See PRD §5.
2. **Every claim in a verdict must cite a source.** No unsourced assertions in summary or red flags.
3. **Disclaimer must appear on every verdict card:**
   > "This is an automated assessment based on publicly available information. It is not legal or financial advice. Sus may be incorrect. Use your own judgment before purchasing."
4. **Never default to "Legit" on no-signal cases.** Return "Not Enough Info" instead.
5. **Verdict schema is fixed** — do not change the structure returned by synthesis without updating shared types:
```json
{
  "trust_score": 0-100,
  "verdict": "Looks Legit" | "Suspicious" | "High Risk" | "Not Enough Info",
  "summary": "2-3 sentence plain English explanation",
  "red_flags": ["...", "...", "..."],
  "green_flags": ["...", "..."],
  "confidence": "High" | "Medium" | "Low",
  "sources": [{"url": "...", "title": "...", "signal_type": "..."}]
}
```

---

## Conventions

- TypeScript strict mode throughout
- Shared types live in `packages/shared` — import from there, don't duplicate
- Scrapers are isolated — each scraper handles its own errors and returns null on failure (never throws and kills the fan-out)
- Environment variables are validated at startup via `apps/api/src/env.ts` — add new vars there
- Do not add secrets to source — use `.env` files (`.env.example` shows the shape)

---

## What to focus on next (priority order)

1. Wire RevenueCat into PaywallScreen (Google Play Billing for Android)
2. Add legal disclaimer footer to VerdictScreen
3. Enforce scan counter (free tier: 3 scans/month, reset on 1st of month UTC)
4. Share verdict as branded image card
5. iOS app + share sheet
6. Play Store submission prep