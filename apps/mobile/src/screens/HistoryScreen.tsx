import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
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
  fetchWatches,
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

const HISTORY_LIMIT = 50;

export default function HistoryScreen({ navigation }: ScreenProps<"History">) {
  const [scans, setScans] = useState<RecentScan[]>([]);
  // Set of target URLs the user is currently watching — used to render the
  // small eye indicator on each history row that's also being monitored.
  // Built once on load; the badge is informational only (tap behaves the same).
  const [watchedTargets, setWatchedTargets] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);

  const load = useCallback(async () => {
    const [rows, quota, watches] = await Promise.all([
      fetchRecentScans(HISTORY_LIMIT),
      fetchQuota(),
      fetchWatches(),
    ]);
    setScans(rows);
    if (quota) setScansLeft(quota.scansLeft);
    setWatchedTargets(new Set(watches.map((w) => w.target)));
    setLoading(false);
    setRefreshing(false);
  }, []);

  const isUnlimited = scansLeft < 0;

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Tapping a row is view-only — navigate straight to the stored Verdict.
  // No re-scrape, no Loading animation, no quota burn, no cache dependency.
  // History is a record of past results, not a re-run trigger.
  //
  // Falls back to re-running the scan if response is missing — handles old
  // rows persisted before /me/scans started returning the JSONB column.
  const openScan = (scan: RecentScan) => {
    if (scan.response) {
      navigation.navigate("Verdict", { result: scan.response, from: "history" });
    } else {
      navigation.navigate("Loading", { kind: "url", url: scan.product_name });
    }
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

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : scans.length === 0 ? (
        <View style={styles.centerWrap}>
          <MaterialIcons
            name="history"
            size={56}
            color={colors.textDim}
          />
          <Text style={styles.emptyTitle}>No scans yet</Text>
          <Text style={styles.emptyBody}>
            Paste or share a link from another app to get your first verdict.
            Scans you run will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          onRefresh={onRefresh}
          refreshing={refreshing}
          renderItem={({ item }) => {
            const isWatched = watchedTargets.has(item.product_name);
            return (
              <Pressable
                onPress={() => openScan(item)}
                style={({ pressed }) => [
                  styles.row,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <ScanThumbnail
                  thumbnailUrl={item.thumbnailUrl}
                  url={item.product_name}
                />
                <View style={styles.rowBody}>
                  <View style={styles.rowTitleRow}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.product_name}
                    </Text>
                    {isWatched && (
                      // Compact eye glyph signals "this scan is also on your
                      // Watch list" — no action, just status. Same icon family
                      // the Watch tab + Verdict button use so the link is
                      // visually consistent across screens.
                      <MaterialIcons
                        name="visibility"
                        size={14}
                        color={colors.primary}
                        style={styles.watchedIcon}
                      />
                    )}
                  </View>
                  <Text style={styles.rowMeta}>
                    {formatRelativeTime(item.scanned_at)}
                  </Text>
                </View>
                <VerdictBadge verdict={item.verdict} size="sm" />
              </Pressable>
            );
          }}
        />
      )}

      <BottomNav active="history" />
    </SafeAreaView>
  );
}

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
  list: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  row: {
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
  rowBody: { flex: 1, paddingVertical: spacing.md, gap: 2 },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    ...typography.bodyMd,
    color: colors.text,
    fontWeight: "400", fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  watchedIcon: {
    opacity: 0.85,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "400", fontFamily: "Inter_400Regular",
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    ...typography.headlineMdMobile,
    color: colors.text,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  emptyBody: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
  },
});
