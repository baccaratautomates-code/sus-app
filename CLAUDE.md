# Sus — Project Rules for Claude

Sus is a mobile app (iOS v1, Android v1.1) that returns a trust verdict on a product/seller URL within ~30 seconds. See [docs/sus-prd.md](docs/sus-prd.md) for the full design.

## Repo layout

This is a Bun-workspaces monorepo.

- [apps/mobile/](apps/mobile/) — React Native + Expo client. Owns the share-sheet integration, UI, local cache, payment SDK.
- [apps/api/](apps/api/) — Bun + Hono API gateway. Owns auth, rate limiting, scan orchestration, payment webhooks.
- [workers/](workers/) — BullMQ scraper workers. One worker per signal source (Trustpilot, Scamadviser, DTI, Reddit, etc.).
- [packages/shared/](packages/shared/) — Shared TypeScript types (Verdict schema, scan request/response, signal types). Imported by both `apps/*` and `workers/*`.
- [docs/](docs/) — Product and design docs.

## Hard rules (from the PRD — non-negotiable)

1. **Never use the word "scam" as a verdict label.** Use `"High Risk"`. Calling a real company a scam is defamation in both US and PH jurisdictions.
2. **Every user-facing claim must cite a source.** If a signal can't be sourced, drop it.
3. **No default to "Looks Legit" on missing data.** Return `"Not Enough Info"` instead.
4. The four allowed verdict labels are exactly: `"Looks Legit"`, `"Suspicious"`, `"High Risk"`, `"Not Enough Info"`. Don't invent new ones.
5. Synthesis uses **Claude Haiku** (cheap, fast, accurate enough). Don't reach for Opus or Sonnet for the per-scan call — the per-scan cost target is <$0.10.

## Code conventions

- TypeScript everywhere. No JS source files.
- Shared types live in `packages/shared` and are the single source of truth for the Verdict schema, scan I/O, and signal types.
- API routes follow REST conventions. The primary endpoint is `POST /scan`.
- Each scraper worker is isolated and independently testable.
- Cache aggressively: 7-day TTL on per-URL verdicts.

## Out of scope for v1

See PRD §6. In particular: no Android in v1.0, no affiliate links, no browser extension, no web dashboard, no GCash/Maya direct billing, no in-store camera scanning.
