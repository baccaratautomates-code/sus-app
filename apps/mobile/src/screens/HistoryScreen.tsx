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
import { QuotaChip } from "../components/QuotaChip";
import { ScanCard } from "../components/ScanCard";
import { SwipeableRow } from "../components/SwipeableRow";
import { UndoSnackbar } from "../components/UndoSnackbar";
import {
  deleteScan,
  fetchQuota,
  fetchRecentScans,
  mockState,
  type RecentScan,
} from "../store";
import { colors, radius, spacing, typography } from "../theme";
import type { ScreenProps } from "../navigation";

const HISTORY_LIMIT = 50;
const UNDO_WINDOW_MS = 4000;

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

  // Deferred-delete / undo state. Deleted rows vanish immediately but the
  // server delete is held for UNDO_WINDOW_MS; UNDO restores the snapshot.
  const [undo, setUndo] = useState<{ count: number } | null>(null);
  const pendingRef = useRef<{ ids: string[]; snapshot: RecentScan[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Commit any pending delete to the server (called when the undo window lapses
  // or the user leaves the screen).
  const commitPending = useCallback(() => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    setUndo(null);
    if (p && p.ids.length) {
      Promise.all(p.ids.map((id) => deleteScan(id))).catch(() => {
        void load();
      });
    }
  }, [load]);

  const isUnlimited = scansLeft < 0;

  useFocusEffect(
    useCallback(() => {
      load();
      // Flush any pending delete when leaving the screen so it isn't lost and
      // the rows don't reappear on a refetch.
      return () => commitPending();
    }, [load, commitPending]),
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

  // Instant delete with an undo window — no confirmation dialog.
  const scheduleDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    commitPending(); // flush any earlier pending batch first
    const idSet = new Set(ids);
    pendingRef.current = { ids, snapshot: scans };
    setScans((prev) => prev.filter((s) => !idSet.has(s.id)));
    setUndo({ count: ids.length });
    undoTimer.current = setTimeout(commitPending, UNDO_WINDOW_MS);
  };

  const undoDelete = () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    const p = pendingRef.current;
    pendingRef.current = null;
    setUndo(null);
    if (p) setScans(p.snapshot);
  };

  const onDeleteSelected = () => {
    if (selected.size === 0) return;
    scheduleDelete([...selected]);
    exitSelect();
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
              disabled={selected.size === 0}
              hitSlop={8}
              style={{ opacity: selected.size === 0 ? 0.35 : 1 }}
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
            <Text style={styles.screenTitle}>History</Text>
            <QuotaChip
              scansLeft={scansLeft}
              onUpgrade={() => navigation.navigate("Paywall")}
            />
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
              onSwipeDelete={() => scheduleDelete([item.id])}
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

      <UndoSnackbar
        visible={undo !== null}
        message={
          undo
            ? undo.count === 1
              ? "Scan deleted"
              : `${undo.count} scans deleted`
            : ""
        }
        onUndo={undoDelete}
      />

      <BottomNav active="history" />
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
  screenTitle: {
    ...typography.headlineMdMobile,
    color: colors.text,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
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
