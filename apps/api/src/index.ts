import { Hono } from "hono";
import type { ScanRequest, ScanResponse } from "@sus/shared";

const app = new Hono();

app.get("/", (c) => c.json({ service: "sus-api", status: "ok" }));

app.post("/scan", async (c) => {
  const body = (await c.req.json()) as ScanRequest;

  // TODO: auth + rate limit + paywall check
  // TODO: cache check (Redis, 7d TTL)
  // TODO: enqueue scraper fan-out
  // TODO: synthesis (Claude Haiku)

  const placeholder: ScanResponse = {
    trust_score: 0,
    verdict: "Not Enough Info",
    summary: "Scan pipeline not implemented yet.",
    red_flags: [],
    green_flags: [],
    confidence: "Low",
    sources: [],
    scanned_at: new Date().toISOString(),
    input: body,
  };

  return c.json(placeholder);
});

export default app;
