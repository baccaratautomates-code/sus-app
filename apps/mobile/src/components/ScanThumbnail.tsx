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
  // Edge length in px. Defaults to 48 (row size); pass larger values for
  // the Verdict hero (~120).
  size?: number;
}

const DEFAULT_SIZE = 48;

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

export function ScanThumbnail({ thumbnailUrl, url, size = DEFAULT_SIZE }: Props) {
  const host = useMemo(() => getHost(url), [url]);

  // step is set ONCE at mount based on the inputs (then advanced only by
  // onError). useState initializer captures the right starting step without
  // re-running on every render.
  const [step, setStep] = useState<"og" | "favicon" | "letter">(() => {
    if (thumbnailUrl) return "og";
    if (host) return "favicon";
    return "letter";
  });

  // Scale auxiliary dimensions (favicon inner image, letter font) with the
  // overall tile so a 120px hero doesn't have a stamp-sized favicon in it.
  const wrapStyle = {
    width: size,
    height: size,
    borderRadius: size >= 96 ? radius.md : radius.default,
  };
  const faviconSize = Math.round(size * 0.58);
  const letterFontSize = Math.round(size * 0.42);

  if (step === "og" && thumbnailUrl) {
    return (
      <View style={[styles.wrap, wrapStyle]}>
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
    // Request 2x the rendered size so hero tiles aren't blurry.
    const sz = Math.max(32, Math.min(128, faviconSize * 2));
    const faviconUri = `https://www.google.com/s2/favicons?domain=${host}&sz=${sz}`;
    return (
      <View style={[styles.wrap, wrapStyle, styles.centered]}>
        <Image
          source={{ uri: faviconUri }}
          style={{ width: faviconSize, height: faviconSize }}
          resizeMode="contain"
          onError={() => setStep("letter")}
        />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, wrapStyle, styles.letterTile]}>
      <Text style={[styles.letterText, { fontSize: letterFontSize }]}>
        {getLetter(url)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    backgroundColor: colors.surfaceContainerHigh,
  },
  image: { width: "100%", height: "100%" },
  centered: { alignItems: "center", justifyContent: "center" },
  letterTile: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryFixed,
  },
  letterText: {
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: colors.primary,
  },
});
