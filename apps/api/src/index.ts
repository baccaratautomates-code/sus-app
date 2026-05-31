import { Hono } from "hono";
import { cors } from "hono/cors";
import Groq from "groq-sdk";
import type { ScanRequest, ScanResponse } from "@sus/shared";
import { bootstrapSchema, sql } from "./db";
import { env } from "./env";
import {
  detectUnsupportedMarketplace,
  extractUrl,
  ocrImage,
  unsupportedMarketplaceMessage,
} from "./ocr";
import { checkQuota, consumeQuota } from "./quota";
import { persistScan, runScan } from "./scan";
import { fetchThumbnail } from "./thumbnail";
import { handleRevenueCatEvent } from "./webhook";

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
    // Include the full response JSONB so tapping a history row can navigate
    // straight to the Verdict screen with the original result — no re-scan,
    // no loading screen, no cache dependency. Adds ~2-3KB per row but at
    // limit=50 that's ~100KB total which is fine for one-shot fetches.
    const rows = (await sql`
      SELECT id, target, verdict, trust_score, response, thumbnail_url, created_at
      FROM scans
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<{
      id: string;
      target: string;
      verdict: string;
      trust_score: number;
      response: unknown;
      thumbnail_url: string | null;
      created_at: Date;
    }>;

    return c.json({
      scans: rows.map((r) => ({
        id: r.id,
        target: r.target,
        verdict: r.verdict,
        trust_score: r.trust_score,
        // Bun.SQL returns JSONB columns as strings, not auto-parsed objects.
        // Parse here so the mobile client receives a real ScanResponse, not a
        // JSON-encoded string. Defensive against future driver behavior change
        // by handling both shapes.
        response: typeof r.response === "string" ? JSON.parse(r.response) : r.response,
        thumbnail_url: r.thumbnail_url,
        scanned_at: r.created_at.toISOString(),
      })),
    });
  } catch (err) {
    console.error(`[me/scans] query failed user=${userId}: ${(err as Error).message}`);
    return c.json({ error: "failed to load scans" }, 500);
  }
});

// Current quota status for the given user. Used by HomeScreen / VerdictScreen /
// HistoryScreen to render the "X scans left" pill against real backend state
// instead of a hardcoded mock. Returns scans_remaining = -1 as a sentinel for
// "unlimited" (Pro users and BYPASS_USER_IDS-listed test accounts).
app.get("/me/quota", async (c) => {
  const userId = c.req.query("user_id");
  if (!userId) return c.json({ error: "user_id required" }, 400);

  try {
    const quota = await checkQuota(userId);
    const remaining = Number.isFinite(quota.scansRemaining) ? quota.scansRemaining : -1;
    return c.json({
      scans_used: quota.scansUsed,
      scans_remaining: remaining,
      is_pro: quota.isPro,
    });
  } catch (err) {
    console.error(`[me/quota] failed user=${userId}: ${(err as Error).message}`);
    return c.json({ error: "failed to load quota" }, 500);
  }
});

// Delete the user's account entirely — scans, public.users row, and
// auth.users row. After this returns, the same Google sign-in creates a
// brand-new UUID with zero history. Mobile calls this then signOut()s to
// invalidate the local session.
//
// Order matters less than you'd think: deleting public.users cascades to
// public.scans via FK ON DELETE CASCADE, and deleting auth.users cascades
// to auth.identities/auth.sessions/auth.refresh_tokens via Supabase's own
// FKs. We do public first so the app-side data is gone even if auth
// deletion fails (e.g. Supabase Postgres role restrictions).
app.delete("/me/account", async (c) => {
  const userId = c.req.query("user_id");
  if (!userId) return c.json({ error: "user_id required" }, 400);

  try {
    // public.users + cascading public.scans
    await sql`DELETE FROM users WHERE id = ${userId}`;
    // auth.users + cascading auth.identities / auth.sessions / auth.refresh_tokens.
    // auth.users.id is uuid; our user_id is the text form of the same uuid.
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    console.log(`[me/account] deleted user=${userId}`);
    return c.json({ ok: true });
  } catch (err) {
    console.error(`[me/account] delete failed user=${userId}: ${(err as Error).message}`);
    return c.json({ error: "failed to delete account" }, 500);
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

  // Early-exit for platforms with no usable third-party signals. Matches the
  // /scan/image pre-check so the share-sheet flow (raw FB Marketplace link)
  // gets the same tailored copy instead of a generic 25s-scrape "Not Enough Info".
  // Still persist to History so the user can see what they tried to scan — the
  // pre-check skips quota + scrape fan-out, NOT recordkeeping.
  if (parsed.value.kind === "url" && parsed.value.url) {
    const unsupported = detectUnsupportedMarketplace(parsed.value.url);
    if (unsupported) {
      console.log(`[scan] ${parsed.value.url} → ${unsupported} not supported — tailored Not Enough Info`);
      // FB Marketplace listings often have a usable og:image (the listing
      // photo) even though we can't gather signals about the seller — grab it
      // so both the Verdict screen and History row get a thumbnail.
      const thumbnailUrl = await fetchThumbnail(parsed.value.url);
      const response: ScanResponse = {
        trust_score: 0,
        verdict: "Not Enough Info",
        summary: unsupportedMarketplaceMessage(unsupported),
        red_flags: [],
        green_flags: [],
        confidence: "Low",
        sources: [],
        scanned_at: new Date().toISOString(),
        input: parsed.value,
        thumbnail_url: thumbnailUrl,
      };
      await persistScan(parsed.value, parsed.value.url, response, thumbnailUrl);
      return c.json({ ...response, is_pro: false });
    }
  }

  // Quota gate (PRD §6.4). DB failures here silent-degrade — we'd rather serve
  // free scans than take the product down because Supabase blipped.
  let quotaIsPro = false;
  try {
    const quota = await checkQuota(parsed.value.user_id);
    quotaIsPro = quota.isPro;
    if (!quota.allowed) {
      return c.json(
        {
          error: "quota_exceeded",
          message: quota.reason ?? "Free quota exceeded.",
          scans_used: quota.scansUsed,
          scans_remaining: 0,
          is_pro: quota.isPro,
        },
        402,
      );
    }
  } catch (err) {
    console.error(`[scan] quota check failed user=${parsed.value.user_id}: ${(err as Error).message} — allowing scan (silent degrade)`);
  }

  try {
    const response = await runScan(parsed.value);
    // Only consume quota on successful scan. Failures don't count.
    try {
      await consumeQuota(parsed.value.user_id);
    } catch (err) {
      console.error(`[scan] consumeQuota failed user=${parsed.value.user_id}: ${(err as Error).message}`);
    }
    return c.json({ ...response, is_pro: quotaIsPro });
  } catch (err) {
    if (err instanceof Groq.APIError) {
      console.error(`[scan] groq ${err.status}: ${err.message}`);
      return c.json({ error: "synthesis failed" }, 502);
    }
    console.error("[scan] failed", err);
    return c.json({ error: "scan failed" }, 500);
  }
});

// Image scan (PRD §3.1). Mobile sends a base64-encoded JPEG; we OCR it, look
// for a marketplace URL in the extracted text, and either (a) run the standard
// scan pipeline on that URL or (b) return Not Enough Info with a helpful nudge.
// Quota gating mirrors /scan exactly so the two endpoints share enforcement.
app.post("/scan/image", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }
  const o = body as Record<string, unknown>;

  if (typeof o.user_id !== "string" || o.user_id.length === 0) {
    return c.json({ error: "user_id required" }, 400);
  }
  if (typeof o.image !== "string" || o.image.length === 0) {
    return c.json({ error: "image (base64) required" }, 400);
  }
  const userId = o.user_id;
  const imageBase64 = o.image;

  let quotaIsPro = false;
  try {
    const quota = await checkQuota(userId);
    quotaIsPro = quota.isPro;
    if (!quota.allowed) {
      return c.json(
        {
          error: "quota_exceeded",
          message: quota.reason ?? "Free quota exceeded.",
          scans_used: quota.scansUsed,
          scans_remaining: 0,
          is_pro: quota.isPro,
        },
        402,
      );
    }
  } catch (err) {
    console.error(`[scan/image] quota check failed user=${userId}: ${(err as Error).message} — allowing scan (silent degrade)`);
  }

  try {
    const ocrText = await ocrImage(imageBase64);
    // Log a preview so we can diagnose "image scan returned wrong URL" without
    // re-running OCR. 240 chars covers a full URL bar + page title. Newlines
    // collapsed so the line stays scannable in Railway logs.
    const ocrPreview = ocrText.slice(0, 240).replace(/\s+/g, " ");
    console.log(
      `[scan/image] OCR ${ocrText.length} chars user=${userId} preview="${ocrPreview}"`,
    );

    const extractedUrl = extractUrl(ocrText);
    if (extractedUrl) {
      // Early-exit for platforms we can't usefully evaluate. Don't burn quota
      // or the 25s scrape fan-out when we know upfront the result will be
      // generic "Not Enough Info" — give the user tailored copy instead.
      const unsupported = detectUnsupportedMarketplace(extractedUrl);
      if (unsupported) {
        console.log(`[scan/image] extracted ${extractedUrl} but ${unsupported} not supported — returning tailored Not Enough Info`);
        const req = { kind: "image" as const, image_id: "uploaded", user_id: userId };
        // Persist with the extracted URL as the History label so the row
        // shows what the user actually scanned (FB Marketplace listing URL),
        // not the opaque "image:uploaded" cache target. Also grab og:image
        // so the Verdict + History rows get a thumbnail.
        const thumbnailUrl = await fetchThumbnail(extractedUrl);
        const response: ScanResponse = {
          trust_score: 0,
          verdict: "Not Enough Info",
          summary: unsupportedMarketplaceMessage(unsupported),
          red_flags: [],
          green_flags: [],
          confidence: "Low",
          sources: [],
          scanned_at: new Date().toISOString(),
          input: req,
          thumbnail_url: thumbnailUrl,
        };
        await persistScan(req, extractedUrl, response, thumbnailUrl);
        return c.json({ ...response, is_pro: quotaIsPro });
      }

      console.log(`[scan/image] extracted URL ${extractedUrl} — running standard scan`);
      const response = await runScan({
        kind: "url",
        url: extractedUrl,
        user_id: userId,
      });
      try {
        await consumeQuota(userId);
      } catch (err) {
        console.error(`[scan/image] consumeQuota failed user=${userId}: ${(err as Error).message}`);
      }
      return c.json({ ...response, is_pro: quotaIsPro });
    }

    // No URL extracted. Return Not Enough Info with copy that nudges the user
    // toward a clearer photo or pasting the URL directly. We don't burn quota
    // on this failure — the user got no value out of the scan.
    const summary = ocrText
      ? "We couldn't find a product URL in the image. Try cropping the screenshot so the address bar is visible, or paste the listing URL directly."
      : "We couldn't read text from this image. Try a clearer photo or paste the listing URL directly.";

    const response: ScanResponse = {
      trust_score: 0,
      verdict: "Not Enough Info",
      summary,
      red_flags: [],
      green_flags: [],
      confidence: "Low",
      sources: [],
      scanned_at: new Date().toISOString(),
      input: { kind: "image", image_id: "uploaded", user_id: userId },
    };
    return c.json({ ...response, is_pro: quotaIsPro });
  } catch (err) {
    console.error("[scan/image] failed", err);
    return c.json({ error: "image scan failed" }, 500);
  }
});

// RevenueCat webhook. Configure the URL + Authorization header in the RC dashboard
// (Project Settings → Integrations → Webhooks). Set REVENUECAT_WEBHOOK_SECRET in
// the API env to the value you put in the dashboard's "Authorization header" field.
//
// Without the secret set, this returns 503 so accidental requests don't pass through.
app.post("/webhooks/revenuecat", async (c) => {
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    console.warn("[webhook] received RC event but REVENUECAT_WEBHOOK_SECRET not set");
    return c.json({ error: "webhook not configured" }, 503);
  }
  // RC's "Authorization header value" field in the dashboard becomes the LITERAL
  // value of the Authorization header — it is NOT prefixed with "Bearer ".
  // Accept either form so misconfigured "Bearer <secret>" entries still work.
  const auth = c.req.header("authorization") ?? "";
  const expected = env.REVENUECAT_WEBHOOK_SECRET;
  if (auth !== expected && auth !== `Bearer ${expected}`) {
    console.warn(`[webhook] auth mismatch (got "${auth.slice(0, 12)}...")`);
    return c.json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  const result = await handleRevenueCatEvent(body);
  if (!result.ok) {
    console.warn(`[webhook] rejected: ${result.reason}`);
    return c.json({ error: result.reason }, result.status as 400 | 401 | 500);
  }
  return c.json({ ok: true });
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
