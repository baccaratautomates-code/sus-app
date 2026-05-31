import { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

// Three-step fallback chain modeled after iMessage/Slack link unfurls:
//   1. og:image (captured at scan time by the API) — actual product photo
//   2. Google's S2 favicons CDN — always serves something for any host
//   3. Letter tile — when the input wasn't a URL at all (image scans without
//      an extractable URL, or future free-text inputs)
//
// onError on <Image> cascades downward — if the og:image 404s or the favicon
// CDN is down, we degrade silently instead of showing a broken-image icon.

interface Props {
  thumbnailUrl?: string | null;
  // The scan target URL — used to construct the favicon fallback and to
  // derive the letter for the final fallback. May not be a real URL for
  // image scans without an extracted listing URL.
  url: string;
}

const SIZE = 48;

function getHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function getLetter(label: string): string {
  // Strip URL scheme + www. so "https://www.shopee.ph/…" yields "S", not "H".
  const cleaned = label.replace(/^https?:\/\/(?:www\.)?/i, "");
  const ch = cleaned[0] ?? "?";
  return ch.toUpperCase();
}

export function ScanThumbnail({ thumbnailUrl, url }: Props) {
  const host = useMemo(() => getHost(url), [url]);

  // step is set ONCE at mount based on the inputs (then advanced only by
  // onError). useState initializer captures the right starting step without
  // re-running on every render.
  const [step, setStep] = useState<"og" | "favicon" | "letter">(() => {
    if (thumbnailUrl) return "og";
    if (host) return "favicon";
    return "letter";
  });

  if (step === "og" && thumbnailUrl) {
    return (
      <View style={styles.wrap}>
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setStep(host ? "favicon" : "letter")}
        />
      </View>
    );
  }

  if (step === "favicon" && host) {
    // Google S2 service — always returns SOMETHING (a default icon if the
    // host has no favicon), so onError is rare. Free, no key required, CDN-cached.
    const faviconUri = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
    return (
      <View style={[styles.wrap, styles.centered]}>
        <Image
          source={{ uri: faviconUri }}
          style={styles.favicon}
          resizeMode="contain"
          onError={() => setStep("letter")}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, styles.letterTile]}>
      <Text style={styles.letterText}>{getLetter(url)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.default,
    overflow: "hidden",
    backgroundColor: colors.surfaceContainerHigh,
  },
  image: { width: "100%", height: "100%" },
  centered: { alignItems: "center", justifyContent: "center" },
  favicon: { width: 28, height: 28 },
  letterTile: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryFixed,
  },
  letterText: {
    fontSize: 20,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: colors.primary,
  },
});
