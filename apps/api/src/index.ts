import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { ScanRequest } from "@sus/shared";
import { runScan } from "./scan";

const app = new Hono();

app.get("/", (c) => c.json({ service: "sus-api", status: "ok" }));

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
    if (err instanceof Anthropic.APIError) {
      console.error(`[scan] anthropic ${err.status}: ${err.message}`);
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
