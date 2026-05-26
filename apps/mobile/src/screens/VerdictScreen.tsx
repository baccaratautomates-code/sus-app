import { useState } from "react";
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
import { VerdictBadge } from "../components/VerdictBadge";
import { usePro } from "../context/ProContext";
import { DISCLAIMER, colors, verdictColor } from "../theme";
import type { ScreenProps } from "../navigation";

export default function VerdictScreen({ navigation, route }: ScreenProps<"Verdict">) {
  const { result } = route.params;
  const { isPro } = usePro();
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const color = verdictColor(result.verdict);
  const flags =
    result.red_flags.length > 0
      ? { items: result.red_flags.slice(0, 3), color: colors.highRisk, label: "Red flags" }
      : {
          items: result.green_flags.slice(0, 3),
          color: colors.legit,
          label: "Green flags",
        };

  const onShare = () => Alert.alert("Share", "Share verdict — coming soon");
  const onSave = () => Alert.alert("Saved", "Saved to your history");
  const onWatch = () => {
    if (!isPro) navigation.navigate("Paywall");
    else Alert.alert("Watching", "We'll alert you if new red flags emerge");
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.scoreWrap}>
          <View style={[styles.scoreCircle, { borderColor: color }]}>
            <Text style={[styles.scoreNumber, { color }]}>{result.trust_score}</Text>
            <Text style={styles.scoreLabel}>TRUST SCORE</Text>
          </View>
          <VerdictBadge verdict={result.verdict} />
          <Text style={styles.confidence}>Confidence: {result.confidence}</Text>
        </View>

        <Text style={styles.summary}>{result.summary}</Text>

        {flags.items.length > 0 && (
          <View style={styles.flagsCard}>
            <Text style={[styles.flagsHeading, { color: flags.color }]}>{flags.label}</Text>
            {flags.items.map((flag, i) => (
              <View key={i} style={styles.flagRow}>
                <View style={[styles.flagDot, { backgroundColor: flags.color }]} />
                <Text style={styles.flagText}>{flag}</Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={() => setSourcesOpen((s) => !s)}
          style={styles.sourcesToggle}
        >
          <Text style={styles.sourcesToggleLabel}>
            {sourcesOpen ? "Hide" : "View"} sources ({result.sources.length})
          </Text>
          <Text style={styles.sourcesChevron}>{sourcesOpen ? "▲" : "▼"}</Text>
        </Pressable>

        {sourcesOpen && (
          <View style={styles.sourcesList}>
            {result.sources.map((s, i) => (
              <Pressable
                key={i}
                onPress={() => Linking.openURL(s.url).catch(() => {})}
                style={styles.sourceRow}
              >
                <Text style={styles.sourceTitle}>{s.title}</Text>
                <Text style={styles.sourceMeta}>{s.signal_type}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.actionsRow}>
          <ActionButton label="Share" onPress={onShare} />
          <ActionButton label="Save" onPress={onSave} />
          <ActionButton
            label="Watch"
            onPress={onWatch}
            proBadge={!isPro}
          />
        </View>

        <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  label,
  onPress,
  proBadge,
}: {
  label: string;
  onPress: () => void;
  proBadge?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionBtn, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={styles.actionLabel}>{label}</Text>
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
  scroll: { padding: 20, paddingBottom: 32 },
  scoreWrap: { alignItems: "center", marginBottom: 24, gap: 12 },
  scoreCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  scoreNumber: { fontSize: 56, fontWeight: "800" },
  scoreLabel: {
    color: colors.textDim,
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: -4,
  },
  confidence: { color: colors.textMuted, fontSize: 13 },
  summary: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 20,
  },
  flagsCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  flagsHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  flagRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  flagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    marginRight: 10,
  },
  flagText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  sourcesToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  sourcesToggleLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  sourcesChevron: { color: colors.textMuted, fontSize: 12 },
  sourcesList: { gap: 8, marginBottom: 16 },
  sourceRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 10,
  },
  sourceTitle: { color: colors.text, fontSize: 14, marginBottom: 2 },
  sourceMeta: {
    color: colors.textDim,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  actionLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  proBadge: {
    backgroundColor: colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  proBadgeLabel: { color: "#1A1A1F", fontSize: 9, fontWeight: "800" },
  disclaimer: {
    color: colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    fontStyle: "italic",
  },
});
