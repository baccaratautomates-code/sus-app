import { Hono } from "hono";
import { cors } from "hono/cors";
import Groq from "groq-sdk";
import type { ScanRequest } from "@sus/shared";
import { bootstrapSchema, sql } from "./db";
import { runScan } from "./scan";

// Run schema bootstrap at module load. If the DB is unreachable we log loudly
// but DO NOT exit — the API still serves scans without persistence. Recent-scans
// history and the /me/scans endpoint will silently degrade until the DB is back.
bootstrapSchema().catch((err) => {
  console.error(`[startup] schema bootstrap failed: ${(err as Error).message}`);
  console.error(`[startup] continuing without DB — scans will not persist, /me/scans will return errors`);
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/", (c) => c.json({ service: "sus-api", status: "ok" }));

// Recent scans for a given user. No auth yet — user_id is a query param.
// Returns at most ?limit=N scans (default 10, max 50) newest first.
app.get("/me/scans", async (c) => {
  const userId = c.req.query("user_id");
  if (!userId) return c.json({ error: "user_id required" }, 400);

  const limitRaw = Number(c.req.query("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 10;

  try {
    const rows = (await sql`
      SELECT id, target, verdict, trust_score, created_at
      FROM scans
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<{
      id: string;
      target: string;
      verdict: string;
      trust_score: number;
      created_at: Date;
    }>;

    return c.json({
      scans: rows.map((r) => ({
        id: r.id,
        target: r.target,
        verdict: r.verdict,
        trust_score: r.trust_score,
        scanned_at: r.created_at.toISOString(),
      })),
    });
  } catch (err) {
    console.error(`[me/scans] query failed user=${userId}: ${(err as Error).message}`);
    return c.json({ error: "failed to load scans" }, 500);
  }
});

app.post("/scan", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }

  const parsed = parseScanRequest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  try {
    const response = await runScan(parsed.value);
    return c.json(response);
  } catch (err) {
    if (err instanceof Groq.APIError) {
      console.error(`[scan] groq ${err.status}: ${err.message}`);
      return c.json({ error: "synthesis failed" }, 502);
    }
    console.error("[scan] failed", err);
    return c.json({ error: "scan failed" }, 500);
  }
});

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseScanRequest(input: unknown): ParseResult<ScanRequest> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const o = input as Record<string, unknown>;

  if (typeof o.user_id !== "string" || o.user_id.length === 0) {
    return { ok: false, error: "user_id required" };
  }

  if (o.kind === "url") {
    if (typeof o.url !== "string" || o.url.length === 0) {
      return { ok: false, error: "url required when kind=url" };
    }
    return { ok: true, value: { kind: "url", url: o.url, user_id: o.user_id } };
  }

  if (o.kind === "image") {
    if (typeof o.image_id !== "string" || o.image_id.length === 0) {
      return { ok: false, error: "image_id required when kind=image" };
    }
    return {
      ok: true,
      value: { kind: "image", image_id: o.image_id, user_id: o.user_id },
    };
  }

  return { ok: false, error: "kind must be 'url' or 'image'" };
}

export default app;
