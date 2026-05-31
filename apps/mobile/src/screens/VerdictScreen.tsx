import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Confidence, Verdict } from "@sus/shared";
import { BottomNav } from "../components/BottomNav";
import { BrandMark } from "../components/BrandMark";
import { ScanThumbnail } from "../components/ScanThumbnail";
import { VerdictBadge } from "../components/VerdictBadge";
import { usePro } from "../context/ProContext";
import {
  ProRequiredError,
  createWatch,
  fetchQuota,
  fetchWatches,
  mockState,
} from "../store";
import {
  DISCLAIMER,
  colors,
  elevation,
  onVerdictContainerColor,
  radius,
  spacing,
  typography,
  verdictColor,
  verdictContainerColor,
} from "../theme";
import type { ScreenProps } from "../navigation";

// Icon used in the flag rows. Picked to match the verdict's emotional tone.
function flagIcon(verdict: Verdict): keyof typeof MaterialIcons.glyphMap {
  switch (verdict) {
    case "Looks Legit":
      return "check-circle";
    case "Suspicious":
      return "warning-amber";
    case "High Risk":
      return "error-outline";
    case "Not Enough Info":
      return "help-outline";
  }
}

function confidenceLevel(c: Confidence): number {
  switch (c) {
    case "High":
      return 3;
    case "Medium":
      return 2;
    case "Low":
      return 1;
  }
}

export default function VerdictScreen({ navigation, route }: ScreenProps<"Verdict">) {
  const { result, from = "scan" } = route.params;
  const { isPro } = usePro();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Refresh the quota pill on mount — a scan just completed, so the server's
  // count has decremented. Without this the pill keeps the pre-scan number
  // (or the boot default) until the user navigates Home.
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);
  useEffect(() => {
    let cancelled = false;
    fetchQuota().then((q) => {
      if (!cancelled && q) setScansLeft(q.scansLeft);
    });
    return () => { cancelled = true; };
  }, []);
  const isUnlimited = scansLeft < 0;

  // Defensive normalization. Old persisted scans (or any payload where the
  // server forgot to parse the JSONB string back to an object) can be missing
  // array fields — without these fallbacks, `result.sources.length` and the
  // flag slices throw and crash the whole screen.
  const verdict = result.verdict ?? "Not Enough Info";
  const redFlags = result.red_flags ?? [];
  const greenFlags = result.green_flags ?? [];
  const sources = result.sources ?? [];

  const accent = verdictColor(verdict);
  const accentContainer = verdictContainerColor(verdict);
  const onAccentContainer = onVerdictContainerColor(verdict);

  // For "Looks Legit" we lead with green flags; for everything else, red flags
  // are the story. "Not Enough Info" intentionally has nothing to say either way.
  const showRedFlags = verdict === "Suspicious" || verdict === "High Risk";
  const showGreenFlags = verdict === "Looks Legit";
  const flagItems = showRedFlags
    ? redFlags.slice(0, 3)
    : showGreenFlags
      ? greenFlags.slice(0, 3)
      : [];
  const flagsHeading = showRedFlags
    ? "Red flags"
    : showGreenFlags
      ? "Green flags"
      : "";

  // Watch state — three booleans rather than one tri-state because the
  // transitions are independent (loading → watched after success; loading →
  // unwatched after failure).
  const [creatingWatch, setCreatingWatch] = useState(false);
  const [isWatched, setIsWatched] = useState(false);

  // The URL this Verdict is about. Used both as the watch key and the
  // ScanThumbnail favicon fallback below.
  const targetUrl =
    result.input?.kind === "url" ? (result.input.url ?? "") : "";

  // On mount, check if this listing is already on the user's Watch list.
  // Cheap: one /me/watches call returning ≤50 rows. Avoids the "I tapped Watch
  // earlier, came back to this Verdict, and the button still says Watch" gap.
  useEffect(() => {
    if (!targetUrl) return;
    let cancelled = false;
    fetchWatches().then((ws) => {
      if (cancelled) return;
      setIsWatched(ws.some((w) => w.target === targetUrl));
    });
    return () => { cancelled = true; };
  }, [targetUrl]);

  const onShare = () => Alert.alert("Share", "Share verdict — coming soon");
  // Watch is server-Pro-gated (canAccessProFeatures includes BYPASS_USER_IDS),
  // so we let the API decide. Fast-path to Paywall for known non-Pro users so
  // we don't make a wasted POST, but on a 402 from the server we still route
  // to Paywall as a fallback.
  const onWatch = async () => {
    if (creatingWatch) return;
    // If already watching, tapping the button takes the user to the Watch tab
    // — much better affordance than a no-op or "are you sure" prompt.
    if (isWatched) {
      navigation.navigate("Watch");
      return;
    }
    if (!isPro) {
      navigation.navigate("Paywall");
      return;
    }
    if (!targetUrl) {
      Alert.alert(
        "Can't watch this",
        "Image-only scans without an extracted URL can't be watched yet.",
      );
      return;
    }
    setCreatingWatch(true);
    try {
      await createWatch({
        target: targetUrl,
        // Label shown on the Watch tab list. The synthesizer's summary is too
        // long; the URL is too noisy. Until we extract product names, use the
        // domain + first path segment as a readable handle.
        label: shortLabel(targetUrl),
        thumbnailUrl: result.thumbnail_url ?? null,
        response: result,
      });
      // Visible inline state change IS the confirmation — Alert.alert on web
      // is a small dismissable dialog that's easy to miss, so we lean on the
      // button itself flipping to "Watching" with a check icon.
      setIsWatched(true);
    } catch (err) {
      if (err instanceof ProRequiredError) {
        navigation.navigate("Paywall");
        return;
      }
      Alert.alert("Couldn't start watch", (err as Error).message);
    } finally {
      setCreatingWatch(false);
    }
  };

  const confLvl = confidenceLevel(result.confidence ?? "Low");

  // Hero thumbnail data. Only URL scans carry a source URL on the response;
  // image scans without a follow-up URL fall back to the letter tile inside
  // ScanThumbnail.
  const heroUrl =
    result.input?.kind === "url" ? (result.input.url ?? "") : "";

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.appHeader}>
        <BrandMark />
        <View style={styles.scansPill}>
          <Text style={styles.scansPillText}>
            {isUnlimited
              ? "Unlimited"
              : `${scansLeft} ${scansLeft === 1 ? "scan" : "scans"} left`}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Verdict card */}
        <View style={[styles.card, { borderColor: accentContainer }]}>
          {/* Hero: product photo (JSON-LD / og:image / Shopee API). Only render
              when we actually got a product image — at 120px a cropped favicon
              (e.g. the FB Marketplace pre-check) looks broken, and the verdict
              badge is sufficient identity for those cases. The row-sized
              ScanThumbnail in History still uses the full fallback chain
              because at 48px favicons look fine. */}
          {result.thumbnail_url && (
            <View style={styles.heroWrap}>
              <ScanThumbnail
                thumbnailUrl={result.thumbnail_url}
                url={heroUrl}
                size={120}
              />
            </View>
          )}

          <VerdictBadge verdict={verdict} />

          {/* Hide the trust score on "Not Enough Info." A big purple "0 / 100"
              reads as "Sus scored this 0% trustworthy" when the actual meaning
              is "we have no data to score this." Showing a dash keeps the
              vertical rhythm of the card while making the no-data state
              visually distinct from a real zero. */}
          {verdict === "Not Enough Info" ? (
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreDash, { color: colors.textMuted }]}>
                — / 100
              </Text>
            </View>
          ) : (
            <View style={styles.scoreRow}>
              <Text style={[styles.scoreNumber, { color: colors.primary }]}>
                {result.trust_score ?? 0}
              </Text>
              <Text style={styles.scoreOutOf}>/ 100</Text>
            </View>
          )}

          <View style={styles.confidenceRow}>
            <Text style={styles.confidenceLabel}>CONFIDENCE</Text>
            <View style={styles.confidenceDots}>
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.confidenceDot,
                    {
                      backgroundColor:
                        i <= confLvl ? accent : colors.surfaceContainerHighest,
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.confidenceValue, { color: accent }]}>
              {result.confidence ?? "Low"}
            </Text>
          </View>

          <Text style={styles.summary}>{result.summary ?? ""}</Text>

          {flagItems.length > 0 && (
            <View style={styles.flagsSection}>
              <Text style={styles.flagsHeading}>
                {flagsHeading.toUpperCase()}
              </Text>
              {flagItems.map((flag, i) => (
                <View key={i} style={styles.flagRow}>
                  <View style={styles.flagLeft}>
                    <MaterialIcons
                      name={flagIcon(verdict)}
                      size={20}
                      color={accent}
                    />
                    <Text style={styles.flagText} numberOfLines={2}>
                      {flag}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={() => setSourcesOpen((s) => !s)}
            style={styles.sourcesToggle}
          >
            <Text style={styles.sourcesToggleLabel}>
              {sourcesOpen ? "Hide" : "View all"} {sources.length} source
              {sources.length === 1 ? "" : "s"}
            </Text>
            <MaterialIcons
              name={sourcesOpen ? "expand-less" : "expand-more"}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>

          {sourcesOpen && (
            <View style={styles.sourcesList}>
              {sources.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => Linking.openURL(s.url).catch(() => {})}
                  style={styles.sourceRow}
                >
                  <Text style={styles.sourceTitle} numberOfLines={1}>
                    {s.title}
                  </Text>
                  <Text style={styles.sourceMeta}>{s.signal_type}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Action row — Save dropped (every scan auto-saves to History; the
            button was a stub). Just Share + Watch now. */}
        <View style={styles.actionsRow}>
          <ActionButton
            label="Share"
            icon="share"
            onPress={onShare}
            tone="neutral"
          />
          <ActionButton
            label={isWatched ? "Watching" : creatingWatch ? "Saving…" : "Watch"}
            icon={isWatched ? "check-circle" : "visibility"}
            onPress={onWatch}
            tone="primary"
            proBadge={!isPro && !isWatched}
            // Visually flip to a filled "active" treatment once added so the
            // user sees the state without needing the alert dialog.
            active={isWatched}
            disabled={creatingWatch}
          />
        </View>

        {/* PRD §5.1: legally-required disclaimer on every verdict card */}
        <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      </ScrollView>

      <BottomNav active={from} />
    </SafeAreaView>
  );
}

// Compact readable label from a URL: host + first path segment when short.
// "https://shopee.ph/dreame-official-store-i.123.456" → "dreame-official-store"
// Falls back to the host alone when the path is empty or too long.
function shortLabel(target: string): string {
  try {
    const u = new URL(target);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (seg && seg.length < 60) {
      // Strip Shopee's "-i.<shop>.<item>" suffix when present so the label is
      // just the seller slug.
      return seg.replace(/-i\.\d+\.\d+$/, "");
    }
    return u.host;
  } catch {
    return target.slice(0, 60);
  }
}

function ActionButton({
  label,
  icon,
  onPress,
  tone,
  proBadge,
  active,
  disabled,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  tone: "neutral" | "primary";
  proBadge?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  const isPrimary = tone === "primary";
  // Active = the action is currently in its "on" state (e.g. Watching). Uses
  // the Looks Legit green so a successful Watch toggle reads visually as
  // "yes, this is now on" without needing an alert dialog.
  const bg = active
    ? colors.legitContainer
    : isPrimary
      ? colors.primaryContainer
      : colors.surfaceContainerHighest;
  const fg = active
    ? colors.onLegitContainer
    : isPrimary
      ? colors.onPrimary
      : colors.primary;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        {
          backgroundColor: bg,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <MaterialIcons name={icon} size={22} color={fg} />
      <Text
        style={[
          styles.actionLabel,
          { color: active ? colors.onLegitContainer : isPrimary ? colors.onPrimary : colors.text },
        ]}
      >
        {label}
      </Text>
      {proBadge && (
        <View style={styles.proBadge}>
          <Text style={styles.proBadgeLabel}>PRO</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  appHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brandName: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  scansPill: {
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  scansPillText: {
    ...typography.labelMd,
    color: colors.primary,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    alignItems: "center",
    ...elevation.card,
  },
  heroWrap: {
    marginBottom: spacing.md,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: spacing.lg,
    gap: 4,
  },
  scoreNumber: {
    ...typography.displayScore,
  },
  scoreOutOf: {
    ...typography.headlineMd,
    color: colors.textDim,
  },
  // Dash variant of the score, shown on "Not Enough Info" so the user reads
  // "no data" rather than "scored zero." Sized down from the displayScore so
  // it doesn't draw the eye the way the real score does.
  scoreDash: {
    ...typography.headlineLgMobile,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  confidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  confidenceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  confidenceDots: { flexDirection: "row", gap: 4 },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  confidenceValue: {
    ...typography.labelMd,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  summary: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  flagsSection: {
    width: "100%",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  flagsHeading: {
    ...typography.labelMd,
    color: colors.text,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  flagRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  flagLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  flagText: {
    ...typography.labelMd,
    color: colors.text,
    flex: 1,
  },
  sourcesToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: spacing.md,
    width: "100%",
    marginTop: spacing.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.outlineVariant,
    borderRadius: radius.md,
  },
  sourcesToggleLabel: {
    ...typography.labelMd,
    color: colors.textMuted,
  },
  sourcesList: {
    width: "100%",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sourceRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.default,
  },
  sourceTitle: {
    ...typography.labelMd,
    color: colors.text,
    marginBottom: 2,
  },
  sourceMeta: {
    ...typography.caption,
    color: colors.textDim,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minHeight: 72,
  },
  actionLabel: {
    ...typography.caption,
    fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },
  proBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  proBadgeLabel: {
    color: colors.onPrimary,
    fontSize: 9,
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.5,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textDim,
    textAlign: "center",
    fontStyle: "italic",
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
});
