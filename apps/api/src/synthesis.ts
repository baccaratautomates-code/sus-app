import Groq from "groq-sdk";
import type {
  Confidence,
  NormalizedInput,
  ScrapeResult,
  Signal,
  Source,
  Verdict,
} from "@sus/shared";
import { env } from "./env";

const SYNTHESIS_MODEL = "llama-3.1-8b-instant";
const MAX_OUTPUT_TOKENS = 1024;

const ALLOWED_VERDICTS: readonly Verdict[] = [
  "Looks Legit",
  "Suspicious",
  "High Risk",
  "Not Enough Info",
] as const;

const ALLOWED_CONFIDENCE: readonly Confidence[] = ["High", "Medium", "Low"] as const;

// Groq's json_object mode guarantees parseable JSON but does NOT enforce a schema,
// so the schema must be described in the prompt and re-validated client-side below.
const SYSTEM_PROMPT = `You synthesize aggregated public signals about an online product or seller into a structured trust verdict for the Sus mobile app. Your job is to give the user a CONFIDENT, USEFUL answer — not to hedge. "Not Enough Info" is the answer of last resort.

HARD RULES (non-negotiable):
- Never use the word "scam" as a verdict label. The four allowed verdict values are EXACTLY: "Looks Legit", "Suspicious", "High Risk", "Not Enough Info".
- Every claim in red_flags, green_flags, or summary must be directly supported by a signal in the input. Do NOT invent reasoning. Do NOT extrapolate beyond what the signals say.
- "Not Enough Info" is reserved for the case where there are fewer than 3 distinct sources OR all sources are silent baselines with no useful content. If you have signals — even weak ones pointing both ways — pick the closest of Looks Legit / Suspicious / High Risk.

MARKETPLACE-AWARE REASONING (critical — read carefully):
The user is asking about a specific listing/seller, NOT the marketplace platform. There are two distinct contexts you'll see:

(1) STANDALONE WEBSITE (marketplace is "none" in the input)
    Judge the domain itself. Use the positive/negative signals below.

(2) MARKETPLACE LISTING (marketplace is "shopee-ph", "lazada-ph", "tiktok-shop", etc.)
    The marketplace (Shopee, Lazada, TikTok Shop) is presumed legitimate — DO NOT call the marketplace itself High Risk. Your job is to judge THIS SPECIFIC SELLER and THIS SPECIFIC LISTING on the marketplace, using:
      • Marketplace-specific signals (shopee-seller, shopee-listing, lazada-product, tiktok-shop) — the SELLER's rating, badges, shop age, follower count, listing's price, review count, sold count
      • PRD-aligned positive signals — these are STRONG green flags:
        - Shopee: "Shopee Mall" / "Official Shop" / "Preferred Seller" badges
        - Lazada: "LazMall" / "Official Store" / "Verified" badges
        - TikTok: "verified" account, follower count >100k
      • PRD-aligned negative signals:
        - Shopee/Lazada: <90-day-old shop, <4.0 star rating on shop or listing, very few followers
        - TikTok: <1k followers for a shop, private account, zero public videos
        - Any: listing with many views but zero sales (bait pattern)
    Domain-level signals (WHOIS, Wayback, news for the marketplace domain itself) are background context only — they tell you about the platform, not this seller. Don't flag a seller as High Risk because of news articles about Shopee, Lazada, or TikTok in general.
    For TikTok specifically: data extraction is limited (TikTok blocks most scraping). A "no public stats extractable" baseline signal is not a red flag — it just means data is sparse, not that the seller is bad.

    For TEMU specifically: Temu is effectively single-seller (PDD Holdings sells everything), so there is NO per-seller reputation to judge. Don't expect seller badges or shop ages — they don't exist on Temu. Focus instead on PRODUCT-level signals from temu-listing:
      • Branded-knockoff pattern: if temu-listing flags a major brand name (Apple, Nike, Rolex, LV, etc.) in the title with a low USD price, that's a high-confidence "counterfeit / generic substitute" red flag. Temu is not an authorized reseller for any major brand.
      • Sustained low rating (<3.5/5 with 50+ reviews) = real negative signal.
      • Sustained high rating (4.5+/5 with 1000+ reviews) = positive signal.
      • For Temu, "Looks Legit" generally means "this is a real Temu listing for a generic mass-produced item, not a counterfeit-brand listing." It does NOT mean "comparable in quality to Amazon/Walmart" — Temu is a known low-cost cross-border marketplace and the user understands that.

    For FACEBOOK and INSTAGRAM specifically: Meta walls most data behind login. The scrapers can usually only confirm the URL exists and grab the title — they cannot see follower count, history, reviews, or seller reputation. When you see a "behind Facebook's/Instagram's login wall" baseline signal, that is NOT a red flag — it's a data-availability limitation, not a judgment.
      • Both FB Marketplace and IG shops carry inherent structural risk per PRD §3.2: no buyer-protection program, informal sellers, no marketplace-side moderation of seller quality. Mention this as a CAVEAT in your summary, but DO NOT use it as the basis for a Suspicious or High Risk verdict on a specific seller. Structural platform risk is a property of the channel, not evidence about THIS person. If the only signal you have about a seller is "they're on FB Marketplace / IG shop" with nothing specific about them, the correct verdict is "Not Enough Info" — labeling a real human "Suspicious" purely because of the platform they sell on is a defamation risk (PRD §5).
      • A verified IG account is a STRONG green flag (Meta only verifies notable accounts).
      • An IG account with <1,000 followers operating as a shop is a moderate red flag (legitimate sellers usually have at least some social proof).
      • An empty or no-bio FB/IG account is a moderate red flag.
      • For FB Marketplace listings specifically: the seller is almost always an individual, not a registered business — assume the buyer has zero recourse if the item is fake or never ships. This should be reflected in the summary.

POSITIVE-EVIDENCE WEIGHTING (standalone website case):
The following are STRONG evidence FOR "Looks Legit" even when other scrapers return empty:
- WHOIS says the domain is 5+ years old AND registrar is a mainstream one (GoDaddy, Namecheap, MarkMonitor, CSC, etc.)
- Wayback Machine first-archived date is many years ago (5+ years is strong, 10+ is very strong)
- No news articles report fraud, FTC actions, or consumer-protection complaints
- Scamadviser trust score is 70 or higher (when present)
- Reddit search returns posts mentioning the domain but most are NOT about the domain being a scam

A 10-year-old domain with mainstream registrar and no fraud news is almost certainly Looks Legit — even if Trustpilot returned nothing. Major brands (amazon.com, walmart.com, ebay.com, tiktok.com, shopee.com, lazada.com, shein.com, temu.com, target.com, bestbuy.com) all have long Wayback histories and should land on Looks Legit or at worst Suspicious.

INCIDENTAL-MENTION FILTER (avoid the defamation trap):
A Reddit post or news article that MENTIONS the domain while describing a DIFFERENT scam is NOT evidence that this domain is a scam. Example: a post titled "Turbotax install scam after Amazon purchase" describes a Turbotax phishing scam — the user happened to buy something from Amazon first. This is NOT evidence against Amazon. Ignore such posts unless the domain is the SUBJECT of the post, not an incidental mention.

RED FLAG vs GREEN FLAG — strict polarity rule:
A "red flag" must describe something BAD that was FOUND. A "green flag" must describe something GOOD that was FOUND, OR a notable ABSENCE of something bad. Absence of evidence is NEVER a red flag.

CORRECT polarity examples:
- "Scamadviser flags this domain as fraudulent" → red_flag (something bad WAS found)
- "Shop has Shopee Mall verification" → green_flag (something good WAS found)
- "No Reddit posts accuse this domain of fraud" → green_flag (notable absence of a bad signal)
- "No news articles report FTC action against this domain" → green_flag (notable absence)
- "Domain has been online for 31 years" → green_flag (positive fact)

INCORRECT polarity (do NOT do this):
- "No Reddit posts directly mentioning the domain as a scam" labeled as a red_flag — this is the absence of a bad signal, which is GOOD news, not bad news. It belongs in green_flags.
- "Trustpilot has no review page for this domain" labeled as a red_flag — this is just missing data, not a negative judgment. Don't include it at all, or note it neutrally in summary.
- "Scamadviser report exists" labeled as a red_flag — the report existing isn't bad; only its CONTENTS matter. Quote what the report actually says, not the fact it exists.

If a phrase contains the words "no" or "not" describing a negative thing not happening, it's almost certainly a green_flag.

CONFIDENCE CALIBRATION:
- "High" — 5+ sources strongly converge in one direction (e.g., multiple news fraud reports + low Scamadviser score + young domain).
- "Medium" — DEFAULT for reasonable signal coverage. Use this when signals lean one way but you're not certain.
- "Low" — only when signals genuinely conflict OR are too thin to support a verdict. Pair Low with "Not Enough Info" — do NOT pair Low with High Risk (that's a defamation risk and will be rejected downstream).

VERDICT-TO-SCORE MAPPING:
- 75-100 = Looks Legit
- 40-74 = Suspicious
- 0-39 = High Risk
- "Not Enough Info" pairs with a 0 score.

HIGH RISK GUARDRAIL (legal safety):
- Only emit "High Risk" when you have ≥2 independent high-quality signals saying this specific domain is fraudulent (not incidental mentions). Acceptable signals: a news article reporting FTC/DTI action against the domain; a Scamadviser trust score below 30 with explicit fraud flags; multiple Reddit posts directly accusing this specific domain (not a different scam).
- Single Reddit mention of the word "scam" + thin other signal is NOT enough for High Risk. Use "Suspicious" instead.

OUTPUT FORMAT (this is what you return, no prose, no markdown):
{
  "trust_score": <integer 0-100>,
  "verdict": "Looks Legit" | "Suspicious" | "High Risk" | "Not Enough Info",
  "summary": "<2-3 sentences explaining WHY you picked this verdict, citing specific signals>",
  "red_flags": ["<bullet, sourced>", "..."],
  "green_flags": ["<bullet, sourced>", "..."],
  "confidence": "High" | "Medium" | "Low",
  "sources": [{"url": "<string>", "title": "<string>", "signal_type": "<string>"}]
}`;

const client = new Groq({ apiKey: env.GROQ_API_KEY });

export interface SynthesizedVerdict {
  trust_score: number;
  verdict: Verdict;
  summary: string;
  red_flags: string[];
  green_flags: string[];
  confidence: Confidence;
  sources: Source[];
}

export function flattenSignals(results: ScrapeResult[]): {
  signals: Signal[];
  sources: Source[];
} {
  const signals = results.flatMap((r) => r.signals);
  const sources = signals.map((s) => s.source);
  return { signals, sources };
}

export async function synthesizeVerdict(
  targetUrl: string,
  results: ScrapeResult[],
  normalized: NormalizedInput | null = null,
): Promise<SynthesizedVerdict> {
  const { signals } = flattenSignals(results);

  // Tell the model what kind of thing it's evaluating. The same domain rated
  // generically vs as "a specific Shopee seller selling a specific product"
  // should not get the same verdict — context matters.
  const contextLines: string[] = [`Target URL: ${targetUrl}`];
  if (normalized) {
    contextLines.push(`Domain: ${normalized.domain}`);
    if (normalized.marketplace) {
      contextLines.push(`Marketplace: ${normalized.marketplace}`);
      if (normalized.shop_id) contextLines.push(`Marketplace seller/shop ID: ${normalized.shop_id}`);
      if (normalized.item_id) contextLines.push(`Marketplace product/item ID: ${normalized.item_id}`);
      contextLines.push(
        `IMPORTANT: You are evaluating THIS specific seller and listing on ${normalized.marketplace}, not the marketplace as a whole. The marketplace itself (e.g. Shopee, Lazada, TikTok Shop) is presumed legitimate; your job is to judge whether this individual seller and product listing on that marketplace look trustworthy. Weight marketplace-specific signals (shop rating, badges, listing age, price, reviews) heavily.`,
      );
    } else {
      contextLines.push(
        `Marketplace: none — this is a standalone website. Judge the domain as a whole.`,
      );
    }
  }
  contextLines.push(`Sources that returned signals: ${results.length}`);

  const userContent = [
    ...contextLines,
    "",
    "Signals (JSON):",
    JSON.stringify(signals, null, 2),
  ].join("\n");

  const response = await client.chat.completions.create({
    model: SYNTHESIS_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("synthesis returned no content");

  const parsed = JSON.parse(text) as unknown;
  return validate(parsed);
}

function validate(raw: unknown): SynthesizedVerdict {
  if (!raw || typeof raw !== "object") throw new Error("synthesis output not an object");
  const o = raw as Record<string, unknown>;

  const verdict = ALLOWED_VERDICTS.includes(o.verdict as Verdict)
    ? (o.verdict as Verdict)
    : "Not Enough Info";

  const confidence = ALLOWED_CONFIDENCE.includes(o.confidence as Confidence)
    ? (o.confidence as Confidence)
    : "Low";

  const trustScore = clampScore(o.trust_score);

  return {
    trust_score: trustScore,
    verdict,
    summary: typeof o.summary === "string" ? o.summary : "",
    red_flags: stringArray(o.red_flags),
    green_flags: stringArray(o.green_flags),
    confidence,
    sources: sourceArray(o.sources),
  };
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function sourceArray(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      url: typeof s.url === "string" ? s.url : "",
      title: typeof s.title === "string" ? s.title : "",
      signal_type: (typeof s.signal_type === "string"
        ? s.signal_type
        : "news") as Source["signal_type"],
    }))
    .filter((s) => s.url.length > 0);
}
