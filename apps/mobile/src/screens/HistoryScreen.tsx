import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { Verdict } from "@sus/shared";
import { BottomNav } from "../components/BottomNav";
import { BrandMark } from "../components/BrandMark";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ScanCard } from "../components/ScanCard";
import { SwipeableRow } from "../components/SwipeableRow";
import {
  clearScans,
  deleteScan,
  fetchQuota,
  fetchRecentScans,
  mockState,
  nextQuotaResetLabel,
  type RecentScan,
} from "../store";
import { colors, radius, spacing, typography } from "../theme";
import type { ScreenProps } from "../navigation";

const HISTORY_LIMIT = 50;

const FILTERS: { key: "all" | Verdict; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Looks Legit", label: "Legit" },
  { key: "Suspicious", label: "Suspicious" },
  { key: "High Risk", label: "High Risk" },
];

export default function HistoryScreen({ navigation }: ScreenProps<"History">) {
  const [scans, setScans] = useState<RecentScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);
  const [filter, setFilter] = useState<"all" | Verdict>("all");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const [dialog, setDialog] = useState<{
    title: string;
    message?: string;
    confirmLabel?: string;
    noticeOnly?: boolean;
  } | null>(null);
  const dialogResolver = useRef<((ok: boolean) => void) | null>(null);

  const askConfirm = (title: string, message: string, confirmLabel = "Delete") =>
    new Promise<boolean>((resolve) => {
      dialogResolver.current = resolve;
      setDialog({ title, message, confirmLabel });
    });

  const showNotice = (title: string, message: string) =>
    new Promise<void>((resolve) => {
      dialogResolver.current = () => resolve();
      setDialog({ title, message, noticeOnly: true });
    });

  const closeDialog = (ok: boolean) => {
    const resolve = dialogResolver.current;
    dialogResolver.current = null;
    setDialog(null);
    resolve?.(ok);
  };

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

  const filtered = useMemo(
    () => (filter === "all" ? scans : scans.filter((s) => s.verdict === filter)),
    [scans, filter],
  );
  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const enterSelect = (preselectId?: string) => {
    setSelectMode(true);
    setSelected(preselectId ? new Set([preselectId]) : new Set());
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((s) => s.id)));
  };

  const onRowPress = (scan: RecentScan) => {
    if (selectMode) {
      toggle(scan.id);
      return;
    }
    if (scan.response) {
      navigation.navigate("Verdict", { result: scan.response, from: "history" });
    } else {
      navigation.navigate("Loading", { kind: "url", url: scan.product_name });
    }
  };

  const onDeleteSelected = async () => {
    if (selected.size === 0) return;
    const n = selected.size;
    const ok = await askConfirm(
      `Delete ${n} ${n === 1 ? "scan" : "scans"}?`,
      "This removes them from your history. This can't be undone.",
    );
    if (!ok) return;
    const ids = new Set(selected);
    setScans((prev) => prev.filter((s) => !ids.has(s.id)));
    exitSelect();
    setWorking(true);
    try {
      await Promise.all([...ids].map((id) => deleteScan(id)));
    } catch {
      await load();
      void showNotice("Couldn't delete", "Some scans couldn't be deleted. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  // Swipe-to-delete a single row: confirm, then optimistically remove + sync.
  const onSwipeDeleteRequest = async (scan: RecentScan) => {
    const ok = await askConfirm(
      "Delete this scan?",
      "This removes it from your history. This can't be undone.",
    );
    if (!ok) return;
    setScans((prev) => prev.filter((s) => s.id !== scan.id));
    try {
      await deleteScan(scan.id);
    } catch {
      await load();
      void showNotice("Couldn't delete", "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {selectMode ? (
        // Contextual selection bar — fully replaces the header + filter tabs.
        <>
          <View style={styles.selectHeader}>
            <Pressable onPress={exitSelect} hitSlop={8}>
              <MaterialIcons name="close" size={24} color={colors.text} />
            </Pressable>
            <Text style={styles.selectCount}>{selected.size}</Text>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={onDeleteSelected}
              disabled={selected.size === 0 || working}
              hitSlop={8}
              style={{ opacity: selected.size === 0 || working ? 0.35 : 1 }}
            >
              <MaterialIcons name="delete-outline" size={24} color={colors.text} />
            </Pressable>
          </View>
          <Pressable onPress={toggleSelectAll} style={styles.selectAllRow}>
            <MaterialIcons
              name={allSelected ? "check-box" : "check-box-outline-blank"}
              size={22}
              color={allSelected ? colors.primary : colors.textDim}
            />
            <Text style={styles.selectAllText}>Select all</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.header}>
            <BrandMark />
            <View style={styles.quotaBlock}>
              <View style={styles.scansPill}>
                <Text style={styles.scansPillText}>
                  {isUnlimited
                    ? "Unlimited"
                    : `${scansLeft} ${scansLeft === 1 ? "scan" : "scans"} left · ${nextQuotaResetLabel()}`}
                </Text>
              </View>
              {!isUnlimited && (
                <Pressable onPress={() => navigation.navigate("Paywall")} hitSlop={8}>
                  <Text style={styles.upgradeLink}>Upgrade to Pro →</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.filterRow}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.centerWrap}>
          <MaterialIcons name="history" size={56} color={colors.textDim} />
          <Text style={styles.emptyTitle}>
            {scans.length === 0 ? "No scans yet" : "Nothing here"}
          </Text>
          <Text style={styles.emptyBody}>
            {scans.length === 0
              ? "Paste or share a link from another app to get your first verdict. Scans you run will show up here."
              : "No scans match this filter."}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          onRefresh={selectMode ? undefined : onRefresh}
          refreshing={refreshing}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <SwipeableRow
              enabled={!selectMode}
              onSwipeDelete={() => onSwipeDeleteRequest(item)}
            >
              <ScanCard
                scan={item}
                selectMode={selectMode}
                selected={selected.has(item.id)}
                onPress={() => onRowPress(item)}
                onLongPress={() => !selectMode && enterSelect(item.id)}
              />
            </SwipeableRow>
          )}
        />
      )}

      <BottomNav active="history" />

      <ConfirmDialog
        visible={dialog !== null}
        title={dialog?.title ?? ""}
        message={dialog?.message}
        confirmLabel={dialog?.confirmLabel}
        noticeOnly={dialog?.noticeOnly}
        onConfirm={() => closeDialog(true)}
        onCancel={() => closeDialog(false)}
      />
    </SafeAreaView>
  );
}

// Date sections: Today / Yesterday / exact date ("OCT 24, 2023"). Assumes
// `scans` is sorted newest-first.
function groupByDate(scans: RecentScan[]): { title: string; data: RecentScan[] }[] {
  if (scans.length === 0) return [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;

  const order: string[] = [];
  const buckets: Record<string, RecentScan[]> = {};
  const push = (title: string, scan: RecentScan) => {
    if (!buckets[title]) {
      buckets[title] = [];
      order.push(title);
    }
    buckets[title].push(scan);
  };

  for (const s of scans) {
    const t = new Date(s.scanned_at).getTime();
    let title: string;
    if (Number.isNaN(t)) title = "EARLIER";
    else if (t >= startOfToday) title = "TODAY";
    else if (t >= startOfToday - DAY) title = "YESTERDAY";
    else
      title = new Date(s.scanned_at)
        .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase();
    push(title, s);
  }

  return order.map((title) => ({ title, data: buckets[title] }));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  quotaBlock: { alignItems: "flex-end", gap: 4 },
  scansPill: {
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  scansPillText: { ...typography.labelMd, color: colors.primary },
  upgradeLink: {
    fontSize: 10,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    color: colors.primary,
    letterSpacing: 0.2,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
  },
  filterChipActive: { backgroundColor: colors.primary },
  filterText: {
    ...typography.labelMd,
    color: colors.textMuted,
    fontFamily: "Inter_600SemiBold",
  },
  filterTextActive: { color: colors.onPrimary },
  selectHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  selectCount: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    fontWeight: "700",
    color: colors.text,
  },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  selectAllText: {
    ...typography.labelMd,
    color: colors.text,
    fontFamily: "Inter_600SemiBold",
  },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.lg },
  sectionHeader: {
    ...typography.caption,
    color: colors.textDim,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  emptyBody: { ...typography.bodyMd, color: colors.textMuted, textAlign: "center" },
});
