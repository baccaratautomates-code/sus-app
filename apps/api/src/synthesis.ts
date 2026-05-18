import Anthropic from "@anthropic-ai/sdk";
import type {
  Confidence,
  ScrapeResult,
  Signal,
  Source,
  Verdict,
} from "@sus/shared";
import { env } from "./env";

const SYNTHESIS_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 1024;

const ALLOWED_VERDICTS: readonly Verdict[] = [
  "Looks Legit",
  "Suspicious",
  "High Risk",
  "Not Enough Info",
] as const;

const ALLOWED_CONFIDENCE: readonly Confidence[] = ["High", "Medium", "Low"] as const;

const SYSTEM_PROMPT = `You synthesize aggregated public signals about an online product or seller into a structured trust verdict for the Sus mobile app.

Hard rules (non-negotiable):
- Never use the word "scam" as a verdict label. The four allowed verdict values are EXACTLY: "Looks Legit", "Suspicious", "High Risk", "Not Enough Info".
- Every claim in red_flags, green_flags, or summary must be supported by a source in the input signals. If a signal has no source, do NOT mention it in user-facing fields.
- If signal coverage is thin — fewer than ~3 independent sources, or no review/scam-DB/news mentions of the seller — return verdict "Not Enough Info". NEVER default to "Looks Legit" on missing data.
- Confidence values are exactly: "High", "Medium", "Low".
- trust_score is an integer 0-100. Calibrate roughly: 75-100 = Looks Legit, 40-74 = Suspicious, 0-39 = High Risk. "Not Enough Info" should pair with a low score and Low confidence.

Output a single JSON object matching the requested schema. No prose, no markdown, no preamble.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    trust_score: { type: "integer", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ALLOWED_VERDICTS },
    summary: { type: "string" },
    red_flags: { type: "array", items: { type: "string" } },
    green_flags: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ALLOWED_CONFIDENCE },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          signal_type: { type: "string" },
        },
        required: ["url", "title", "signal_type"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "trust_score",
    "verdict",
    "summary",
    "red_flags",
    "green_flags",
    "confidence",
    "sources",
  ],
  additionalProperties: false,
} as const;

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

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

  const response = await client.messages.create({
    model: SYNTHESIS_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("synthesis returned no text content");
  }

  const parsed = JSON.parse(textBlock.text) as unknown;
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
      signal_type: (typeof s.signal_type === "string" ? s.signal_type : "news") as Source["signal_type"],
    }))
    .filter((s) => s.url.length > 0);
}
