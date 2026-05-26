import { Platform } from "react-native";
import type { ScanResponse, Verdict } from "@sus/shared";

// Dev API base. Web hits localhost directly; native (iOS/Android) needs the
// host's LAN IP since "localhost" on a device/emulator points at itself.
// Swap via env or a config screen when you stand up real deployments.
// Set EXPO_PUBLIC_API_BASE in your .env to override for staging/production.
// Dev fallback: web → localhost, native → your machine's LAN IP.
const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ??
  (Platform.OS === "web" ? "http://localhost:3000" : "http://localhost:3000");

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

// Stand-in user identity. Replace with real auth user once that lands.
export const CURRENT_USER_ID = "test-user";

// GET /me/scans — returns the user's recent scans newest first.
// Returns an empty array on any failure (network, server, etc.) so the UI just
// shows the empty state instead of crashing.
export async function fetchRecentScans(limit = 10): Promise<RecentScan[]> {
  try {
    const res = await fetch(
      `${API_BASE}/me/scans?user_id=${encodeURIComponent(CURRENT_USER_ID)}&limit=${limit}`,
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
export async function requestScan(
  url: string,
  signal?: AbortSignal,
): Promise<ScanResponse> {
  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "url", url, user_id: "test-user" }),
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
