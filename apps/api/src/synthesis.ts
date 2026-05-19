import Groq from "groq-sdk";
import type {
  Confidence,
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
const SYSTEM_PROMPT = `You synthesize aggregated public signals about an online product or seller into a structured trust verdict for the Sus mobile app.

Hard rules (non-negotiable):
- Never use the word "scam" as a verdict label. The four allowed verdict values are EXACTLY: "Looks Legit", "Suspicious", "High Risk", "Not Enough Info".
- Every claim in red_flags, green_flags, or summary must be supported by a source in the input signals. If a signal has no source, do NOT mention it in user-facing fields.
- If signal coverage is thin — fewer than ~3 independent sources, or no review/scam-DB/news mentions of the seller — return verdict "Not Enough Info". NEVER default to "Looks Legit" on missing data.
- Confidence values are exactly: "High", "Medium", "Low".
- trust_score is an integer 0-100. Calibrate roughly: 75-100 = Looks Legit, 40-74 = Suspicious, 0-39 = High Risk. "Not Enough Info" should pair with a low score and Low confidence.

Output ONLY a single JSON object matching this exact schema. No prose, no markdown fences, no preamble:
{
  "trust_score": <integer 0-100>,
  "verdict": "Looks Legit" | "Suspicious" | "High Risk" | "Not Enough Info",
  "summary": "<string, 2-3 sentences>",
  "red_flags": ["<string>", "..."],
  "green_flags": ["<string>", "..."],
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
): Promise<SynthesizedVerdict> {
  const { signals } = flattenSignals(results);

  const userContent = [
    `Target: ${targetUrl}`,
    `Sources that returned signals: ${results.length}`,
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
