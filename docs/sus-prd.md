# Sus — Product Trust Checker
**Design / Product Requirements Document**

- **Date:** 2026-05-18
- **Owner:** Kyle (kyle@disruptorsmedia.com)
- **Status:** Draft v1 — pre-implementation
- **Working name:** Sus (final brand TBD pre-launch)

---

## 1. Positioning

**A mobile app that tells you in 30 seconds whether the product you're about to buy is legit, suspicious, or high-risk — before you spend the money.**

### Target user
Middle-class consumers, ages 18–60, in the **Philippines** and **United States**, who frequently purchase from:
- TikTok Shop
- Facebook Marketplace / Facebook ads
- Shopee, Lazada (PH)
- Instagram stores
- Direct-response ads (YouTube, TikTok ads, etc.)
- Independent dropshipper sites

### Wedge
"Is this product/seller legitimate?" can already be answered crudely by ChatGPT or Google. The wedge is **not** the answer — it's the combination of:
1. **Speed:** verdict in ≤30 seconds
2. **Trust:** sourced, structured, mobile-native output (vs. a chat reply)
3. **Right moment:** lives in the mobile share sheet, available at the exact instant the user is about to spend money

### Why now / why this market
- TikTok Shop scams are exploding in both PH and US (2025–2026 surge)
- PH middle class is the global epicenter of social-commerce purchases with weak consumer protection enforcement
- No dominant mobile-native product exists in this category (Trustpilot, Scamadviser, BBB are all desktop/web)

---

## 2. Core User Flow

### Primary path — URL via mobile share sheet (~80% of usage)

1. User sees a suspicious TikTok Shop / Shopee / Facebook Marketplace / Instagram listing
2. Taps **Share → Sus** in the native share sheet
3. App opens to a **loading state**: "Investigating…" with rotating status text
   - "Checking seller history…"
   - "Scanning reviews…"
   - "Cross-referencing scam databases…"
   - "Validating price against market…"
4. Within ~30 seconds, **Verdict Card** appears:
   - Large trust score (0–100)
   - One-word verdict: **Looks Legit** / **Suspicious** / **High Risk** / **Not Enough Info**
   - 2–3 sentence plain-English summary
   - Top 3 red flags (or green flags if Legit)
   - Confidence indicator (High / Medium / Low)
   - Tap to expand: full sources cited (clickable)
5. Bottom of card:
   - **Share verdict** button — exports a branded image card (viral loop)
   - **Save** (auto-saved to history)
   - **Watch** (Pro only — re-check periodically, alert on new red flags)
6. Disclaimer footer (legally required — see §5)

### Secondary path — Image upload

Same flow, but user uploads or takes a photo of a product/screenshot. Pipeline:
1. Reverse image search (Google Lens or SerpAPI) → identify product/seller
2. OCR fallback → extract brand and product text from packaging or screenshot
3. Proceed to standard investigation pipeline

### Free tier paywall trigger
- Scans 1–3 of the calendar month: free, full verdict
- Scan 4: paywall slides up mid-investigation
  - Headline: "You've used your 3 free scans this month."
  - CTA: "Unlock unlimited for $10/mo (₱299 in PH)"
  - Subhead: "Cancel anytime. 30-second verdicts. Unlimited history."

---

## 3. The Verdict Engine

### 3.1 Input normalization
- **URL input:** Extract canonical product URL, seller name, product name, listed price, marketplace identifier
- **Image input:** Reverse image search → product/seller identification → OCR fallback for brand text

### 3.2 Parallel investigation pipeline (the 30s budget)

All scrapers run concurrently. Target: 25s p95 for all signal collection, 5s for synthesis.

| Signal category | Sources |
|---|---|
| **Seller reputation** | Trustpilot, Sitejabber, BBB, Scamadviser, Reddit (r/scams, r/Flipping, country subs), X/Twitter mentions |
| **PH-specific signals** | DTI Consumer Care complaints, PH Facebook scam groups, Shopee/Lazada native ratings, NPC privacy complaints |
| **Domain signals** | WHOIS (age, registrar), SSL cert, IsItDownRightNow, Scamadviser API |
| **Price sanity** | Compare listed price vs. Amazon, official brand site, Google Shopping. Flag >50% under market as counterfeit signal |
| **Review authenticity** | Fakespot-style analysis: review velocity spikes, generic language patterns, repeat reviewers |
| **Internal scam DB** | Proprietary database, built from user reports + scam-tracking feeds; grows weekly |
| **News & media** | Recent news mentions of brand/seller — fraud charges, recalls, FTC actions, DTI complaints |

### 3.3 Synthesis layer

Collected signals are passed to **Claude Haiku** with a structured prompt that returns:

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

**Model choice rationale:** Haiku, not Opus. The heavy lifting is scraping/aggregation, not reasoning. Haiku is cheap, fast (<2s synthesis), and accurate enough at this synthesis task.

**Per-scan cost target:** <$0.10 in API + scraping costs.

### 3.4 Insufficient-data handling

If signal coverage is below a threshold (new seller, no review presence, no scam DB hits, no news mentions): verdict returns **"Not Enough Info"** with a yellow icon — **never** a default "Legit."

Rationale:
- Defaulting to Legit on no-signal cases creates massive legal liability if the user gets scammed
- Trains users to distrust the product
- "Not Enough Info" is itself useful — tells the user "this seller is so obscure even the internet doesn't know about them"

### 3.5 Caching

- Per-URL cache: 7-day TTL (most scam listings persist longer than that)
- Cache-hit returns instantly, no scraping cost
- "Watch" feature (Pro) refreshes the cache every 24h and notifies on verdict change

### 3.6 Continuous learning

Every scan, anonymized, feeds the internal scam DB. Over 6+ months this becomes the strongest differentiator vs. any single-source check.

---

## 4. Pricing, Paywall & Monetization

### 4.1 Free tier
- 3 scans per calendar month
- Full verdict including sources (do not gimp the free experience)
- History: last 10 scans only
- In-app counter: "2 free scans left this month"
- Reset on the 1st of each calendar month (UTC)

### 4.2 Pro tier
- **US:** $9.99/mo or $79.99/year (34% annual savings)
- **PH:** ₱299/mo or ₱2,490/year (Apple/Google storefront-tier pricing, ~$5.30/$44 USD equivalent)
- Unlimited scans
- Unlimited history
- **Watch** feature (alerts on seller/product when new red flags emerge)
- Share verdict as a branded image card
- Priority scan speed (more parallel scrapers / dedicated queue)

### 4.3 Regional pricing rationale
- US at $9.99 is the proven sweet spot for consumer utility apps
- PH at $10 USD would kill conversion — local purchasing power requires ~50% discount
- Apple and Google handle FX via storefront-tier pricing, no custom billing logic needed in v1

### 4.4 Payment rails
- Apple In-App Purchase (iOS — required by store policy)
- Google Play Billing (Android — required by store policy)
- v2+: GCash/Maya direct billing via web-based upgrade flow (PH only) to avoid 30% Apple/Google tax

### 4.5 Future revenue (out of scope for v1)
- **Affiliate links:** When verdict is "Suspicious" or "High Risk," surface a legit alternative from Amazon/Lazada/etc. with affiliate tracking (3–8% commission)
- **Pro+ ($24.99/mo):** Bulk scans, business use case (resellers verifying inventory before purchase)
- **API access:** B2B for marketplaces wanting to embed trust scores

### 4.6 Unit economics target

| Metric | Target |
|---|---|
| Avg scans / paid user / month | 8–15 |
| Per-scan API + scraping cost | <$0.10 |
| Avg cost per paid user | <$1.50 |
| US revenue per paid user | $9.99 |
| PH revenue per paid user | ~$5.30 |
| Blended gross margin | ~85% |
| Target CAC (blended) | <$8 |
| Payback period | <1 month |

---

## 5. Legal & Trust Framing (Critical)

Calling a real company "scam" without proof is **defamation** in both US (per quod) and PH (Article 353, Revised Penal Code). This is the single largest non-technical risk to the business.

### 5.1 Hard rules in v1

1. **Never use "scam" as a verdict label.** Use **"High Risk"** instead — communicates the same warning without the legal exposure.
2. **Every claim in the verdict must cite a source.** No unsourced assertions in summary or red flags. If a signal cannot be sourced, it is not included in user-facing output.
3. **Disclaimer present on every verdict card:**
   > *"This is an automated assessment based on publicly available information. It is not legal or financial advice. Sus may be incorrect. Use your own judgment before purchasing."*

### 5.2 Additional safeguards

- **Seller counter-claim mechanism:** Any business can submit a counter-claim through a web form. Sus re-investigates within 7 days and adjusts verdict if warranted.
- **Audit trail:** Every verdict's input signals are logged for 90 days. If a takedown notice arrives, the engineering team can show their work.
- **Terms of Service classification:** Output is explicitly classified as "opinion based on aggregated public data" — falls under protected speech (US 1st Amendment, PH free expression jurisprudence).
- **DMCA-style takedown queue:** Public email/form for legal complaints, triaged within 48 business hours.

### 5.3 Risk-of-being-sued mitigation
- Incorporate as an LLC in the US (Delaware) with PH operations as a service contractor
- Carry media liability insurance ($1M minimum) from month 1 of paid subscriptions
- Engage a media/IP lawyer on retainer in both jurisdictions for the first 12 months

---

## 6. Explicitly Not in V1 (YAGNI)

Cut to ensure an 8–10 week launch window:

- ❌ Camera-based in-store product scanning (v2 — much harder ML problem)
- ❌ Affiliate "buy this instead" recommendations (v2 — needs partnerships)
- ❌ Android app (v1.1 — ships 4–6 weeks after iOS launch)
- ❌ Browser extension (v2)
- ❌ Web dashboard
- ❌ Multi-language UI (English only; both PH and US target users are English-literate)
- ❌ Pro+ business tier
- ❌ Seller verification "claim your business" flow
- ❌ Real-time alerts beyond Watch feature
- ❌ Community reviews / social features
- ❌ GCash/Maya direct billing (use Apple/Google IAP only in v1)

---

## 7. Success Metrics & Kill Criteria

### 7.1 Success targets (3 months post-launch)

| Metric | Target |
|---|---|
| Installs | 10,000 (60% PH, 40% US) |
| Free → paid conversion | 8% |
| Paying users | 800 |
| MRR (blended) | ~$5,000 |
| D30 retention (paid) | >25% |
| Avg scans / paid user / month | 8–15 |
| Viral coefficient (k) | >0.3 |

### 7.2 Kill criteria (abandon if any are true at the 3-month mark)

- Free→paid conversion <2% — product doesn't earn the $10 price
- D30 retention <10% (paid) — people churn fast, value isn't sticky
- 5+ takedown / legal notices in first 3 months — liability cost exceeds revenue ceiling
- Per-scan unit cost >$0.50 — engine economics don't work at $10/mo

---

## 8. Architecture (High-Level)

### 8.1 Stack proposal

- **Mobile (iOS v1, Android v1.1):** React Native or native Swift. Lean toward **React Native** to share the codebase for the Android follow-up and reduce time-to-Android by ~50%.
- **Backend API:** Bun + Hono (fast, cheap, fits the existing Claude/Bun tooling Kyle already uses) hosted on Cloudflare Workers or Fly.io.
- **Scraping layer:** A queue-based worker pool (BullMQ or QStash). Each signal scraper is an isolated worker. Concurrent fan-out per scan request.
- **Synthesis:** Claude Haiku via the Anthropic API, with prompt caching enabled for the system prompt (the structured-output instructions are static — cache them).
- **Cache + DB:** Postgres for users/scans/history; Redis for the 7-day URL verdict cache.
- **Payments:** RevenueCat in front of Apple IAP + Google Play Billing — standard for cross-platform mobile subscription apps.

### 8.2 Component boundaries

1. **Mobile client** — owns: share-sheet integration, UI, local cache, payment SDK
2. **API gateway** — owns: auth, rate limiting, scan request orchestration, payment webhook handling
3. **Scraper workers** — owns: per-source signal collection, retries, source-specific parsing
4. **Synthesis service** — owns: prompt construction, Anthropic API call, schema validation
5. **Internal scam DB** — owns: anonymized scan ingestion, pattern detection, source-of-truth for "known bad" lookups

Each component has one clear job, talks to others via well-defined interfaces (REST or queue messages), and can be tested in isolation.

### 8.3 Data flow

```
[Mobile share sheet] → [API gateway: /scan]
                          ↓
                  [Auth + rate limit + paywall check]
                          ↓
                  [Cache check (Redis, 7d TTL)] — hit? return immediately
                          ↓ (miss)
                  [Scraper worker fan-out] (parallel, ~25s budget)
                          ↓ (signals collected)
                  [Synthesis service] (Haiku, ~5s)
                          ↓
                  [Verdict written to Postgres + Redis cache]
                          ↓
                  [Anonymized ingestion → internal scam DB]
                          ↓
                  [Verdict returned to client → render card]
```

---

## 9. Open Questions for Implementation Planning

These are deferred from this design and will be answered during the writing-plans phase:

1. Exact list of v1 scrapers (which sources ship in launch vs. fast-follow)
2. iOS native vs. React Native — final call after a 1-day spike on both
3. Hosting choice (Cloudflare Workers vs. Fly.io vs. Railway)
4. Internal scam DB schema and the threshold model for "Known Bad" flagging
5. Exact paywall copy and pricing-screen design (A/B test plan)
6. Specific compliance posture for App Store / Play Store review (especially around "scam" language)

---

## 10. Out of Scope for This Document

- Visual design / brand identity (handled in a follow-up design sprint)
- Detailed copywriting for in-app strings
- Exact analytics event taxonomy
- Customer support tooling and runbooks
- Implementation timeline / milestones (handled in writing-plans phase)
