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
import { VerdictBadge } from "../components/VerdictBadge";
import { usePro } from "../context/ProContext";
import { fetchQuota, mockState } from "../store";
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
  const { result } = route.params;
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

  const accent = verdictColor(result.verdict);
  const accentContainer = verdictContainerColor(result.verdict);
  const onAccentContainer = onVerdictContainerColor(result.verdict);

  // For "Looks Legit" we lead with green flags; for everything else, red flags
  // are the story. "Not Enough Info" intentionally has nothing to say either way.
  const showRedFlags =
    result.verdict === "Suspicious" || result.verdict === "High Risk";
  const showGreenFlags = result.verdict === "Looks Legit";
  const flagItems = showRedFlags
    ? result.red_flags.slice(0, 3)
    : showGreenFlags
      ? result.green_flags.slice(0, 3)
      : [];
  const flagsHeading = showRedFlags
    ? "Red flags"
    : showGreenFlags
      ? "Green flags"
      : "";

  const onShare = () => Alert.alert("Share", "Share verdict — coming soon");
  const onSave = () => Alert.alert("Saved", "Saved to your history");
  const onWatch = () => {
    if (!isPro) navigation.navigate("Paywall");
    else Alert.alert("Watching", "We'll alert you if new red flags emerge");
  };

  const confLvl = confidenceLevel(result.confidence);

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
          <VerdictBadge verdict={result.verdict} />

          <View style={styles.scoreRow}>
            <Text style={[styles.scoreNumber, { color: colors.primary }]}>
              {result.trust_score}
            </Text>
            <Text style={styles.scoreOutOf}>/ 100</Text>
          </View>

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
              {result.confidence}
            </Text>
          </View>

          <Text style={styles.summary}>{result.summary}</Text>

          {flagItems.length > 0 && (
            <View style={styles.flagsSection}>
              <Text style={styles.flagsHeading}>
                {flagsHeading.toUpperCase()}
              </Text>
              {flagItems.map((flag, i) => (
                <View key={i} style={styles.flagRow}>
                  <View style={styles.flagLeft}>
                    <MaterialIcons
                      name={flagIcon(result.verdict)}
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
              {sourcesOpen ? "Hide" : "View all"} {result.sources.length} source
              {result.sources.length === 1 ? "" : "s"}
            </Text>
            <MaterialIcons
              name={sourcesOpen ? "expand-less" : "expand-more"}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>

          {sourcesOpen && (
            <View style={styles.sourcesList}>
              {result.sources.map((s, i) => (
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

        {/* Action row */}
        <View style={styles.actionsRow}>
          <ActionButton
            label="Share"
            icon="share"
            onPress={onShare}
            tone="neutral"
          />
          <ActionButton
            label="Save"
            icon="bookmark-outline"
            onPress={onSave}
            tone="neutral"
          />
          <ActionButton
            label="Watch"
            icon="visibility"
            onPress={onWatch}
            tone="primary"
            proBadge={!isPro}
          />
        </View>

        {/* PRD §5.1: legally-required disclaimer on every verdict card */}
        <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      </ScrollView>

      <BottomNav active="scan" />
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  tone,
  proBadge,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  tone: "neutral" | "primary";
  proBadge?: boolean;
}) {
  const isPrimary = tone === "primary";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionBtn,
        {
          backgroundColor: isPrimary
            ? colors.primaryContainer
            : colors.surfaceContainerHighest,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <MaterialIcons
        name={icon}
        size={22}
        color={isPrimary ? colors.onPrimary : colors.primary}
      />
      <Text
        style={[
          styles.actionLabel,
          { color: isPrimary ? colors.onPrimary : colors.text },
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
