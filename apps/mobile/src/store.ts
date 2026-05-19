import { Platform } from "react-native";
import type { ScanResponse, Verdict } from "@sus/shared";

// Dev API base. Web hits localhost directly; native (iOS/Android) needs the
// host's LAN IP since "localhost" on a device/emulator points at itself.
// Swap via env or a config screen when you stand up real deployments.
const API_BASE =
  Platform.OS === "web" ? "http://localhost:3000" : "http://192.168.1.6:3000";

export interface RecentScan {
  id: string;
  product_name: string;
  verdict: Verdict;
  scanned_at: string;
}

// Mock in-memory state for the prototype. Replace with persistent storage later.
// scansLeft / isPro / recentScans are read by HomeScreen, VerdictScreen, PaywallScreen.
export const mockState = {
  // TODO: reset to 3 before production
  scansLeft: 10,
  isPro: false,
  recentScans: [
    {
      id: "r1",
      product_name: "Acme Wireless Earbuds Pro",
      verdict: "Looks Legit" as Verdict,
      scanned_at: "2026-05-18T14:22:00Z",
    },
    {
      id: "r2",
      product_name: "$12 'iPhone 15 Pro' from @giftshop_ph",
      verdict: "High Risk" as Verdict,
      scanned_at: "2026-05-17T09:11:00Z",
    },
    {
      id: "r3",
      product_name: "TikTok Shop weight-loss tea",
      verdict: "Suspicious" as Verdict,
      scanned_at: "2026-05-15T19:43:00Z",
    },
  ] as RecentScan[],
};

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
