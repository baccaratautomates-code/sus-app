import { useEffect } from "react";
import { Platform } from "react-native";
import { useShareIntent } from "expo-share-intent";
import { navigationRef } from "../navigation";

// Mounted once inside NavigationContainer. Routes incoming shared URLs into
// the scan flow from two sources:
//   1. Native iOS Share Extension / Android ACTION_SEND (via expo-share-intent)
//   2. Web ?url= query param (so the Vercel demo can simulate a share via link)
export function ShareTargetHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    debug: __DEV__,
    resetOnBackground: true,
  });

  // Native share intent → navigate to Loading
  useEffect(() => {
    if (!hasShareIntent) return;
    const url = shareIntent?.webUrl ?? extractUrl(shareIntent?.text ?? "");
    if (url) routeToScan(url);
    resetShareIntent();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  // Web ?url= fallback (used by the Vercel demo so shared links can be tested
  // without an iOS/Android native build)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("url");
    if (!raw) return;
    const url = extractUrl(decodeURIComponent(raw));
    if (!url) return;
    routeToScan(url);
    // Strip the query so a refresh doesn't re-trigger the scan loop.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  return null;
}

// Navigate as soon as the navigator is ready. Share intents can arrive before
// the navigation container has finished mounting, so we retry briefly.
function routeToScan(url: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate("Loading", { kind: "url", url });
    return;
  }
  let attempts = 0;
  const id = setInterval(() => {
    attempts += 1;
    if (navigationRef.isReady()) {
      clearInterval(id);
      navigationRef.navigate("Loading", { kind: "url", url });
    } else if (attempts > 20) {
      clearInterval(id);
    }
  }, 100);
}

// Pulls the first http(s) URL out of arbitrary shared text. Lazada / Shopee /
// TikTok Shop often share text like "Check this out! https://shopee.ph/..."
// rather than a clean URL.
function extractUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (match) return match[0];
  // Last-chance: treat the whole string as a URL if it looks like one.
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}
