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

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Server returned ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

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

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Server returned ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return (await res.json()) as ScanResponse;
}
