# Sus

A mobile app that tells you in 30 seconds whether a product you're about to buy is legit, suspicious, or high risk — before you spend the money.

See [docs/sus-prd.md](docs/sus-prd.md) for the full design.

## Stack

- **Mobile** — React Native + Expo ([apps/mobile](apps/mobile))
- **API** — Bun + Hono ([apps/api](apps/api))
- **Workers** — BullMQ scraper pool ([workers](workers))
- **Shared types** — TypeScript ([packages/shared](packages/shared))
- **Synthesis** — Claude Haiku via the Anthropic API
- **Data** — Postgres (users, scans, history) + Redis (7-day URL verdict cache)
- **Payments** — RevenueCat over Apple IAP + Google Play Billing

Monorepo managed with Bun workspaces.
