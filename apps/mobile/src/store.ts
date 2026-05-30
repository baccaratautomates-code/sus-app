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
  throw new Error(`Server returned ${res.status}${text ? `: ${text}` : ""}`);
}

export interface RecentScan {
  id: string;
  product_name: string;
  verdict: Verdict;
  scanned_at: string;
}

// Mock in-memory state for the prototype. Replace with persistent storage later.
// scansLeft / isPro are read by HomeScreen, VerdictScreen, PaywallScreen.
// recentScans is no longer used as the source of truth — HomeScreen now fetches
// real history from GET /me/scans. Kept here as a typed empty fallback.
export const mockState = {
  // Dev: bumped from 3 to 999 so we don't hit the paywall while iterating.
  // Real free-tier enforcement (3/mo) will move server-side once auth lands.
  scansLeft: 999,
  isPro: false,
  recentScans: [] as RecentScan[],
};

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
      }>;
    };
    return (body.scans ?? []).map((s) => ({
      id: s.id,
      // Until product-name extraction exists, show the URL as the title.
      product_name: s.target,
      verdict: s.verdict,
      scanned_at: s.scanned_at,
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
