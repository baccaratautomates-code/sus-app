import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { BottomNav } from "../components/BottomNav";
import { BrandMark } from "../components/BrandMark";
import { ScanThumbnail } from "../components/ScanThumbnail";
import { VerdictBadge } from "../components/VerdictBadge";
import {
  fetchQuota,
  fetchRecentScans,
  mockState,
  type RecentScan,
} from "../store";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";
import type { ScreenProps } from "../navigation";

interface HowStep {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
}

const HOW_STEPS: HowStep[] = [
  { icon: "share", label: "Share" },
  { icon: "search", label: "Investigating" },
  { icon: "gavel", label: "Verdict" },
];

export default function HomeScreen({ navigation }: ScreenProps<"Home">) {
  const [url, setUrl] = useState("");
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchRecentScans(5).then((scans) => {
        if (!cancelled) setRecentScans(scans);
      });
      // Pull fresh quota state from the server every time Home gets focus —
      // after a scan completes the user comes back here and the pill should
      // reflect the real remaining count, not whatever we last cached.
      fetchQuota().then((q) => {
        if (!cancelled && q) setScansLeft(q.scansLeft);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // scansLeft === -1 is the unlimited sentinel (Pro / BYPASS_USER_IDS). Don't
  // gate scans for them. Only block when the count is exactly 0.
  const isUnlimited = scansLeft < 0;

  const onCheck = () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isUnlimited && scansLeft <= 0) {
      navigation.navigate("Paywall");
      return;
    }

    navigation.navigate("Loading", { kind: "url", url: trimmed });
    setUrl("");
  };

  // PRD §3.1 image input. Launches the OS image picker (photo library on web;
  // camera + library on native), then sends the chosen image base64 to the
  // scan pipeline. The Loading screen handles the OCR-then-scan dance.
  const onUseImage = async () => {
    if (!isUnlimited && scansLeft <= 0) {
      navigation.navigate("Paywall");
      return;
    }

    // No media-library permission needed on iOS for the new ImagePicker —
    // Apple handles consent inline. Android + web work the same way.
    const result = await ImagePicker.launchImageLibraryAsync({
      // SDK 54 replaced MediaTypeOptions with the array form. Restricting to
      // ["images"] excludes video so we don't try to OCR a clip.
      mediaTypes: ["images"],
      // Down-sample on the way out so we don't ship a 12MB iPhone shot to the
      // OCR endpoint. 1280px on the long edge is plenty for URL bars + text.
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.base64) {
      Alert.alert(
        "Couldn't read image",
        "Try a different photo or paste the listing URL instead.",
      );
      return;
    }

    navigation.navigate("Loading", { kind: "image", image: asset.base64 });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <BrandMark />
        <View style={styles.scansPill}>
          <Text style={styles.scansPillText}>
            {isUnlimited
              ? "Unlimited"
              : `${scansLeft} ${scansLeft === 1 ? "scan" : "scans"} left`}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Scan card */}
        <View style={styles.scanCard}>
          <Text style={styles.scanTitle}>Scan for risks</Text>
          <Text style={styles.scanSubtitle}>
            Paste a listing URL or upload a screenshot to check credibility.
          </Text>

          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              placeholder="Paste product link…"
              placeholderTextColor={colors.textDim}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={onCheck}
            />
            <MaterialIcons
              name="link"
              size={20}
              color={colors.textDim}
              style={styles.inputIcon}
            />
          </View>

          <Pressable
            onPress={onCheck}
            disabled={!url.trim()}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: pressed || !url.trim() ? 0.8 : 1 },
            ]}
          >
            <MaterialIcons
              name="qr-code-scanner"
              size={20}
              color={colors.onPrimary}
            />
            <Text style={styles.primaryBtnLabel}>Analyze Link</Text>
          </Pressable>

          <Pressable
            onPress={onUseImage}
            style={({ pressed }) => [
              styles.secondaryBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <MaterialIcons name="image" size={20} color={colors.text} />
            <Text style={styles.secondaryBtnLabel}>Use image</Text>
          </Pressable>
        </View>

        {/* How it works */}
        <Text style={styles.sectionHeading}>HOW IT WORKS</Text>
        <View style={styles.howRow}>
          {HOW_STEPS.map((step) => (
            <View key={step.label} style={styles.howCard}>
              <View style={styles.howIconWrap}>
                <MaterialIcons
                  name={step.icon}
                  size={22}
                  color={colors.primary}
                />
              </View>
              <Text style={styles.howLabel}>{step.label}</Text>
            </View>
          ))}
        </View>

        {/* Recent scans */}
        <View style={styles.recentHeaderRow}>
          <Text style={styles.sectionHeading}>RECENT SCANS</Text>
          {recentScans.length > 0 && (
            <Pressable onPress={() => navigation.navigate("History")}>
              <Text style={styles.viewAll}>View all</Text>
            </Pressable>
          )}
        </View>

        {recentScans.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No scans yet — paste a link above to get started.
            </Text>
          </View>
        ) : (
          <View style={styles.recentList}>
            {recentScans.map((scan) => (
              <Pressable
                key={scan.id}
                onPress={() => {
                  // scan.response can be undefined for scans persisted before
                  // /me/scans started returning the JSONB column — fall back
                  // to a re-scan in that case so the row still works.
                  if (scan.response) {
                    navigation.navigate("Verdict", {
                      result: scan.response,
                      from: "history",
                    });
                  } else {
                    navigation.navigate("Loading", {
                      kind: "url",
                      url: scan.product_name,
                    });
                  }
                }}
                style={({ pressed }) => [
                  styles.recentRow,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <ScanThumbnail
                  thumbnailUrl={scan.thumbnailUrl}
                  url={scan.product_name}
                />
                <View style={styles.recentBody}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {scan.product_name}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {formatRelativeTime(scan.scanned_at)}
                  </Text>
                </View>
                <VerdictBadge verdict={scan.verdict} size="sm" />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <BottomNav active="scan" />
    </SafeAreaView>
  );
}

// "2m ago" / "3h ago" / "Oct 24" style. Simple human-friendly relative time
// without pulling in date-fns just for this one helper.
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
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
    paddingBottom: spacing.lg * 2,
    gap: spacing.lg,
  },
  scanCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    gap: spacing.md,
    ...elevation.card,
  },
  scanTitle: {
    ...typography.headlineMdMobile,
    color: colors.text,
  },
  scanSubtitle: {
    ...typography.bodyMd,
    color: colors.textMuted,
  },
  inputWrap: { position: "relative", justifyContent: "center" },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingRight: spacing.xl + 4,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inputIcon: {
    position: "absolute",
    right: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryBtnLabel: {
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  secondaryBtn: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  secondaryBtnLabel: {
    color: colors.text,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  sectionHeading: {
    ...typography.labelMd,
    color: colors.textMuted,
    letterSpacing: 1.2,
  },
  howRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  howCard: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    padding: spacing.md,
    alignItems: "center",
    gap: spacing.sm,
  },
  howIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: "center",
    justifyContent: "center",
  },
  howLabel: {
    ...typography.caption,
    color: colors.text,
    fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },
  recentHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  viewAll: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  recentList: { gap: spacing.sm },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    paddingHorizontal: spacing.md,
    overflow: "hidden",
    gap: spacing.sm,
    ...elevation.card,
  },
  recentBody: {
    flex: 1,
    paddingVertical: spacing.md,
    gap: 2,
  },
  recentName: {
    ...typography.bodyMd,
    color: colors.text,
    fontWeight: "400", fontFamily: "Inter_400Regular",
  },
  recentMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "400", fontFamily: "Inter_400Regular",
  },
  emptyState: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.textMuted,
    fontStyle: "italic",
    textAlign: "center",
  },
});
