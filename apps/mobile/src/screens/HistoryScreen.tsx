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
import { VerdictBadge } from "../components/VerdictBadge";
import { fetchQuota, fetchRecentScans, mockState, type RecentScan } from "../store";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
  verdictColor,
} from "../theme";
import type { ScreenProps } from "../navigation";

const HISTORY_LIMIT = 50;

export default function HistoryScreen({ navigation }: ScreenProps<"History">) {
  const [scans, setScans] = useState<RecentScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);

  const load = useCallback(async () => {
    const [rows, quota] = await Promise.all([
      fetchRecentScans(HISTORY_LIMIT),
      fetchQuota(),
    ]);
    setScans(rows);
    if (quota) setScansLeft(quota.scansLeft);
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

  // Tapping a row re-runs the scan. The 7-day URL cache on the API side returns
  // the previous verdict instantly without re-scraping, so this is effectively
  // a "view detail" affordance without needing a separate /scans/:id endpoint.
  const openScan = (url: string) =>
    navigation.navigate("Loading", { kind: "url", url });

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
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openScan(item.product_name)}
              style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View
                style={[
                  styles.accent,
                  { backgroundColor: verdictColor(item.verdict) },
                ]}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.product_name}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatRelativeTime(item.scanned_at)}
                </Text>
              </View>
              <VerdictBadge verdict={item.verdict} size="sm" />
            </Pressable>
          )}
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
    paddingRight: spacing.md,
    overflow: "hidden",
    gap: spacing.sm,
    ...elevation.card,
  },
  accent: { width: 4, alignSelf: "stretch" },
  rowBody: { flex: 1, paddingVertical: spacing.md, gap: 2 },
  rowTitle: {
    ...typography.bodyMd,
    color: colors.text,
    fontWeight: "400", fontFamily: "Inter_400Regular",
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
