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
import { BottomNav } from "../components/BottomNav";
import { BrandMark } from "../components/BrandMark";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ScanThumbnail } from "../components/ScanThumbnail";
import { VerdictBadge } from "../components/VerdictBadge";
import {
  clearScans,
  deleteScan,
  fetchQuota,
  fetchRecentScans,
  fetchWatches,
  mockState,
  nextQuotaResetLabel,
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
  const [watchedTargets, setWatchedTargets] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);

  // Multi-select state. `selectMode` toggles checkboxes + the contextual action
  // bar; `selected` holds the ids ticked for deletion.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  // In-app confirm/notice dialog state. `dialogResolver` lets us keep the
  // ergonomic `await askConfirm(...)` API while rendering our own modal instead
  // of the browser-native confirm/alert.
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

  // Group scans into relative date buckets for SectionList. The API already
  // returns rows newest-first, so iterating in order keeps both the section
  // order and the within-section order correct without re-sorting.
  const sections = useMemo(() => groupByDate(scans), [scans]);

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

  const allSelected = scans.length > 0 && selected.size === scans.length;
  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(scans.map((s) => s.id)));
  };

  // Tapping a row: in select mode it toggles the checkbox; otherwise it opens
  // the stored verdict (view-only — no re-scrape, no quota burn).
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

  const removeIdsLocally = (ids: Set<string>) => {
    setScans((prev) => prev.filter((s) => !ids.has(s.id)));
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
    // Optimistic: drop them from the list immediately, then sync the server.
    removeIdsLocally(ids);
    exitSelect();
    setWorking(true);
    try {
      await Promise.all([...ids].map((id) => deleteScan(id)));
    } catch {
      // A delete failed — reload to get the true server state back.
      await load();
      void showNotice("Couldn't delete", "Some scans couldn't be deleted. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const onClearAll = async () => {
    if (scans.length === 0) return;
    const ok = await askConfirm(
      "Clear all history?",
      `This permanently removes all ${scans.length} scans from your history. This can't be undone.`,
      "Clear all",
    );
    if (!ok) return;
    const snapshot = scans;
    setScans([]);
    exitSelect();
    setWorking(true);
    try {
      await clearScans();
    } catch {
      setScans(snapshot); // revert
      void showNotice("Couldn't clear history", "Please try again.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
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

      {/* Contextual toolbar: "Select" in normal mode, selection controls in
          select mode. Only shown when there are scans to act on. */}
      {!loading && scans.length > 0 && (
        <View style={styles.toolbar}>
          {selectMode ? (
            <>
              <Pressable onPress={exitSelect} hitSlop={8}>
                <Text style={styles.toolbarAction}>Cancel</Text>
              </Pressable>
              <Text style={styles.toolbarCount}>
                {selected.size > 0 ? `${selected.size} selected` : "Select items"}
              </Text>
              <Pressable onPress={toggleSelectAll} hitSlop={8}>
                <Text style={styles.toolbarAction}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.toolbarTitle}>
                {scans.length} {scans.length === 1 ? "scan" : "scans"}
              </Text>
              <Pressable onPress={() => enterSelect()} hitSlop={8}>
                <Text style={styles.toolbarAction}>Select</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : scans.length === 0 ? (
        <View style={styles.centerWrap}>
          <MaterialIcons name="history" size={56} color={colors.textDim} />
          <Text style={styles.emptyTitle}>No scans yet</Text>
          <Text style={styles.emptyBody}>
            Paste or share a link from another app to get your first verdict.
            Scans you run will show up here.
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
          renderItem={({ item }) => {
            const isWatched = watchedTargets.has(item.product_name);
            const isSelected = selected.has(item.id);
            return (
              <Pressable
                onPress={() => onRowPress(item)}
                onLongPress={() => !selectMode && enterSelect(item.id)}
                delayLongPress={250}
                style={({ pressed }) => [
                  styles.row,
                  isSelected && styles.rowSelected,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                {selectMode && (
                  <MaterialIcons
                    name={isSelected ? "check-circle" : "radio-button-unchecked"}
                    size={22}
                    color={isSelected ? colors.primary : colors.textDim}
                  />
                )}
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

      {/* Contextual action bar — only in select mode, sits above the tab bar. */}
      {selectMode && (
        <View style={styles.actionBar}>
          <Pressable
            onPress={onClearAll}
            disabled={working}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed || working ? 0.6 : 1 }]}
          >
            <Text style={styles.clearAllText}>Clear all</Text>
          </Pressable>
          <Pressable
            onPress={onDeleteSelected}
            disabled={selected.size === 0 || working}
            style={({ pressed }) => [
              styles.deleteButton,
              (selected.size === 0 || working) && styles.deleteButtonDisabled,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <MaterialIcons name="delete-outline" size={18} color="#fff" />
            <Text style={styles.deleteButtonText}>
              {selected.size > 0 ? `Delete (${selected.size})` : "Delete"}
            </Text>
          </Pressable>
        </View>
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

// Buckets scans into relative date sections. Assumes `scans` is already sorted
// newest-first (the /me/scans API orders by created_at DESC).
function groupByDate(
  scans: RecentScan[],
): { title: string; data: RecentScan[] }[] {
  if (scans.length === 0) return [];
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
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
    if (Number.isNaN(t)) title = "Earlier";
    else if (t >= startOfToday) title = "Today";
    else if (t >= startOfToday - DAY) title = "Yesterday";
    else if (t >= startOfToday - 7 * DAY) title = "Previous 7 days";
    else if (t >= startOfToday - 30 * DAY) title = "Previous 30 days";
    else title = "Earlier";
    push(title, s);
  }

  return order.map((title) => ({ title, data: buckets[title] }));
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
    fontWeight: "900",
    fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  quotaBlock: {
    alignItems: "flex-end",
    gap: 4,
  },
  scansPill: {
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  scansPillText: {
    ...typography.labelMd,
    color: colors.primary,
  },
  upgradeLink: {
    fontSize: 10,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    color: colors.primary,
    letterSpacing: 0.2,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  toolbarTitle: {
    ...typography.labelMd,
    color: colors.textMuted,
  },
  toolbarCount: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  toolbarAction: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  sectionHeader: {
    ...typography.labelMd,
    color: colors.textMuted,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryFixed,
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
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
    flexShrink: 1,
  },
  watchedIcon: {
    opacity: 0.85,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
  },
  clearAllText: {
    ...typography.labelMd,
    color: colors.highRisk,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.highRisk,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  deleteButtonDisabled: {
    backgroundColor: colors.textDim,
  },
  deleteButtonText: {
    ...typography.labelMd,
    color: "#fff",
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
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
  emptyBody: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
  },
});
