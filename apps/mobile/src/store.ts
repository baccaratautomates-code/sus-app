import { Platform } from "react-native";
import type { ScanResponse, Verdict } from "@sus/shared";
import { supabase } from "./supabase";

// Dev API base. Web hits localhost directly; native (iOS/Android) needs the
// host's LAN IP since "localhost" on a device/emulator points at itself.
// Swap via env or a config screen when you stand up real deployments.
// Set EXPO_PUBLIC_API_BASE in your .env to override for staging/production.
// Dev fallback: web → localhost, native → your machine's LAN IP.
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  (Platform.OS === "web" ? "http://localhost:3000" : "http://localhost:3000");

// Reads the active Supabase session and returns the user's id. Returns null
// if the user isn't signed in — callers in authenticated screens treat null
// as "skip the request" (the AuthScreen prevents this from happening in
// practice, but defensively returning null keeps tests + the loading flash
// from crashing).
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// Thrown when the API returns 402 quota_exceeded. The LoadingScreen catches
// this specifically and replaces the route with Paywall instead of showing
// the generic "Couldn't get a verdict" error state with raw JSON in it.
export class QuotaExceededError extends Error {
  scansUsed: number;
  isPro: boolean;
  constructor(message: string, scansUsed: number, isPro: boolean) {
    super(message);
    this.name = "QuotaExceededError";
    this.scansUsed = scansUsed;
    this.isPro = isPro;
  }
}

// Thrown when the API returns 422 non_commerce_url. PRD §1 scopes Sus to
// product/seller listings — news / gov / social / search URLs hit this gate
// before quota is consumed. LoadingScreen catches it and renders a "not a
// product link" message instead of running the scan.
export class NonCommerceUrlError extends Error {
  title: string;
  constructor(title: string, message: string) {
    super(message);
    this.name = "NonCommerceUrlError";
    this.title = title;
  }
}

// Inspects a non-2xx response and throws either QuotaExceededError (for 402)
// or a generic Error with the response body inlined for everything else.
// Centralizes the error shape so both requestScan and requestImageScan
// behave identically from the caller's perspective.
async function throwFromResponse(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  if (res.status === 402) {
    try {
      const body = JSON.parse(text) as {
        message?: string;
        scans_used?: number;
        is_pro?: boolean;
      };
      throw new QuotaExceededError(
        body.message ?? "Free quota exceeded.",
        body.scans_used ?? 0,
        body.is_pro ?? false,
      );
    } catch (err) {
      if (err instanceof QuotaExceededError) throw err;
      // JSON parse failed — fall through to generic error below.
    }
  }
  if (res.status === 422) {
    try {
      const body = JSON.parse(text) as {
        error?: string;
        title?: string;
        message?: string;
      };
      if (body.error === "non_commerce_url") {
        throw new NonCommerceUrlError(
          body.title ?? "That doesn't look like a product link.",
          body.message ??
            "Sus checks product and seller listings before you buy. Try a link from Shopee, Lazada, TikTok Shop, Facebook Marketplace, or Instagram.",
        );
      }
    } catch (err) {
      if (err instanceof NonCommerceUrlError) throw err;
      // JSON parse failed — fall through to generic error below.
    }
  }
  throw new Error(`Server returned ${res.status}${text ? `: ${text}` : ""}`);
}

export interface RecentScan {
  id: string;
  product_name: string;
  verdict: Verdict;
  scanned_at: string;
  // The original ScanResponse, captured at scan time. Tapping a history row
  // navigates directly to the Verdict screen with this — no re-scrape, no
  // dependence on the URL cache TTL.
  response: ScanResponse;
  // og:image URL captured at scan time. Null when scrape failed, the page
  // lacked og:image, or input wasn't a URL — ScanThumbnail falls back to
  // favicon → letter tile.
  thumbnailUrl: string | null;
}

// Pro-tier Watch feature row. Server re-runs the scan against `target` every
// ~24h; if the new verdict is materially worse, `pendingAlert` gets populated
// and the user sees a notification dot on the Watch tab.
export interface WatchAlert {
  old_verdict: Verdict;
  new_verdict: Verdict;
  old_trust_score: number;
  new_trust_score: number;
  new_red_flags: string[];
  summary: string;
  checked_at: string;
}

export interface Watch {
  id: string;
  target: string;
  label: string;
  thumbnailUrl: string | null;
  lastVerdict: Verdict;
  lastTrustScore: number;
  lastResponse: ScanResponse;
  createdAt: string;
  lastCheckedAt: string;
  nextCheckAt: string;
  pendingAlert: WatchAlert | null;
}

// Thrown by createWatch when the user isn't Pro. Mobile catches this and
// navigates to Paywall instead of showing a generic error.
export class ProRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProRequiredError";
  }
}

// Shared in-memory state for the prototype. Mutated by fetchQuota() after each
// scan / on focus, read by HomeScreen / VerdictScreen / HistoryScreen for the
// "X scans left" pill. scansLeft = -1 is the unlimited sentinel (Pro users or
// BYPASS_USER_IDS-listed test accounts) — display "Unlimited" in that case.
// Defaults to 3 (the free-tier monthly quota) until the first fetchQuota()
// call replaces it with the real backend value.
export const mockState = {
  scansLeft: 3,
  isPro: false,
  recentScans: [] as RecentScan[],
};

// DELETE /me/account — wipes the user's scans, profile row, and auth.users
// record so the same Google sign-in creates a fresh UUID next time. Throws
// on any non-2xx so the Settings screen can surface a useful error. Caller
// must signOut() after this resolves to clear the now-orphaned local session.
export async function deleteAccount(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Not signed in");
  const res = await fetch(
    `${API_BASE}/me/account?user_id=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Server returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

// GET /me/quota — refreshes mockState.scansLeft + isPro from the server.
// Returns the same shape it writes to mockState so callers can read it
// synchronously without re-importing mockState. Silently no-ops on any
// failure (no session, network error, server 500) so the pill keeps showing
// the previous value instead of jumping to 0.
export async function fetchQuota(): Promise<{ scansLeft: number; isPro: boolean } | null> {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const res = await fetch(
      `${API_BASE}/me/quota?user_id=${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      scans_remaining?: number;
      is_pro?: boolean;
    };
    const scansLeft = body.scans_remaining ?? 0;
    const isPro = body.is_pro ?? false;
    mockState.scansLeft = scansLeft;
    mockState.isPro = isPro;
    return { scansLeft, isPro };
  } catch {
    return null;
  }
}

// GET /me/scans — returns the user's recent scans newest first.
// Returns an empty array on any failure (network, server, no-session) so the
// UI just shows the empty state instead of crashing.
export async function fetchRecentScans(limit = 10): Promise<RecentScan[]> {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const res = await fetch(
      `${API_BASE}/me/scans?user_id=${encodeURIComponent(userId)}&limit=${limit}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      scans?: Array<{
        id: string;
        target: string;
        verdict: Verdict;
        scanned_at: string;
        response: ScanResponse;
        thumbnail_url: string | null;
      }>;
    };
    return (body.scans ?? []).map((s) => ({
      id: s.id,
      // Until product-name extraction exists, show the URL as the title.
      product_name: s.target,
      verdict: s.verdict,
      scanned_at: s.scanned_at,
      response: s.response,
      thumbnailUrl: s.thumbnail_url,
    }));
  } catch {
    return [];
  }
}

// Real scan request. Pass an AbortSignal to cancel (used for timeout + unmount).
// Throws if there's no signed-in user — callers should be on an authed screen
// already so this should never fire in practice.
export async function requestScan(
  url: string,
  signal?: AbortSignal,
): Promise<ScanResponse> {
  const userId = await currentUserId();
  if (!userId) {
    throw new Error("Not signed in. Please sign in before scanning.");
  }
  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "url", url, user_id: userId }),
    signal,
  });

  if (!res.ok) await throwFromResponse(res);

  return (await res.json()) as ScanResponse;
}

// GET /me/watches — list current user's active watches, newest first.
// Returns [] on any failure (no session, network, server) so the Watch tab
// can render an empty state without a hard error.
export async function fetchWatches(): Promise<Watch[]> {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const res = await fetch(
      `${API_BASE}/me/watches?user_id=${encodeURIComponent(userId)}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      watches?: Array<{
        id: string;
        target: string;
        label: string;
        thumbnail_url: string | null;
        last_verdict: Verdict;
        last_trust_score: number;
        last_response: ScanResponse;
        created_at: string;
        last_checked_at: string;
        next_check_at: string;
        pending_alert: WatchAlert | null;
      }>;
    };
    return (body.watches ?? []).map((w) => ({
      id: w.id,
      target: w.target,
      label: w.label,
      thumbnailUrl: w.thumbnail_url,
      lastVerdict: w.last_verdict,
      lastTrustScore: w.last_trust_score,
      lastResponse: w.last_response,
      createdAt: w.created_at,
      lastCheckedAt: w.last_checked_at,
      nextCheckAt: w.next_check_at,
      pendingAlert: w.pending_alert,
    }));
  } catch {
    return [];
  }
}

// POST /me/watches — start watching a listing. Server-side gates on Pro
// entitlement. Throws ProRequiredError on 402 so the Verdict screen can
// route to Paywall; throws a generic Error on other failures.
export async function createWatch(args: {
  target: string;
  label: string;
  thumbnailUrl: string | null;
  response: ScanResponse;
}): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Not signed in");
  const res = await fetch(`${API_BASE}/me/watches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      target: args.target,
      label: args.label,
      thumbnail_url: args.thumbnailUrl,
      last_verdict: args.response.verdict,
      last_trust_score: args.response.trust_score,
      last_response: args.response,
    }),
  });
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    throw new ProRequiredError(
      (body as { message?: string }).message ?? "Watch is a Pro feature.",
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Server returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
}

// DELETE /me/watches/:id — stop watching. Silent no-op on any failure
// (the Watch screen optimistically removes the row; if the server didn't
// actually delete it, the next fetchWatches() will bring it back).
export async function deleteWatch(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await fetch(
    `${API_BASE}/me/watches/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  ).catch(() => {});
}

// POST /me/watches/:id/dismiss — clear the staged pending_alert. Used when
// the user views or acknowledges a Watch notification. Silent on failure.
export async function dismissWatchAlert(id: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  await fetch(
    `${API_BASE}/me/watches/${encodeURIComponent(id)}/dismiss?user_id=${encodeURIComponent(userId)}`,
    { method: "POST" },
  ).catch(() => {});
}

// Image scan request. Image is sent as a base64-encoded string in the JSON
// body so we don't have to deal with multipart on the Bun side. The backend
// OCRs the image, extracts any URL or brand text, then runs the standard
// signal pipeline on whatever it found.
export async function requestImageScan(
  imageBase64: string,
  signal?: AbortSignal,
): Promise<ScanResponse> {
  const userId = await currentUserId();
  if (!userId) {
    throw new Error("Not signed in. Please sign in before scanning.");
  }
  const res = await fetch(`${API_BASE}/scan/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "image",
      image: imageBase64,
      user_id: userId,
    }),
    signal,
  });

  if (!res.ok) await throwFromResponse(res);

  return (await res.json()) as ScanResponse;
}
