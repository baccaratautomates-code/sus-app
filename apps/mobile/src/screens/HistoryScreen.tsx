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
import type { ScanResponse, Verdict } from "@sus/shared";
import { BottomNav } from "../components/BottomNav";
import { BrandMark } from "../components/BrandMark";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ScanThumbnail } from "../components/ScanThumbnail";
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
import { colors, elevation, radius, spacing, typography } from "../theme";
import type { ScreenProps } from "../navigation";

const HISTORY_LIMIT = 50;

// Top filter chips. "all" shows everything (including Not Enough Info); the
// other three filter to a single verdict.
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

  // Multi-select state.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  // In-app confirm/notice dialog (replaces browser confirm/alert).
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

  // "Select all" operates on the currently-visible (filtered) rows.
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
      setScans(snapshot);
      void showNotice("Couldn't clear history", "Please try again.");
    } finally {
      setWorking(false);
    }
  };

  // Swipe-to-delete a single row. Confirm first (a stray swipe shouldn't nuke a
  // scan), then optimistically remove and sync the server.
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

      {/* Verdict filter chips */}
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

      {/* Selection toolbar — only in select mode (entered via long-press). */}
      {selectMode && (
        <View style={styles.toolbar}>
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
        </View>
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
          renderItem={({ item }) => {
            const meta = verdictMeta(item.verdict);
            const isSelected = selected.has(item.id);
            const score =
              item.verdict === "Not Enough Info"
                ? "—"
                : String(item.response?.trust_score ?? "—");
            return (
              <SwipeableRow
                enabled={!selectMode}
                onSwipeDelete={() => onSwipeDeleteRequest(item)}
              >
                <Pressable
                  onPress={() => onRowPress(item)}
                  onLongPress={() => !selectMode && enterSelect(item.id)}
                  delayLongPress={250}
                  style={({ pressed }) => [
                    styles.card,
                    isSelected && styles.cardSelected,
                    { opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  {selectMode && (
                    <MaterialIcons
                      name={isSelected ? "check-circle" : "radio-button-unchecked"}
                      size={22}
                      color={isSelected ? colors.primary : colors.textDim}
                      style={styles.checkbox}
                    />
                  )}
                  <ScanThumbnail
                    thumbnailUrl={item.thumbnailUrl}
                    url={item.product_name}
                  />
                  <View style={styles.cardBody}>
                    <View style={styles.cardTopRow}>
                      <View style={[styles.chip, { backgroundColor: meta.chipBg }]}>
                        <Text style={[styles.chipText, { color: meta.chipText }]}>
                          {meta.label}
                        </Text>
                      </View>
                      <Text style={styles.sourceLabel} numberOfLines={1}>
                        {sourceLabel(item.product_name)}
                      </Text>
                    </View>
                    <Text style={styles.productName} numberOfLines={2}>
                      {productName(item)}
                    </Text>
                  </View>
                  <View style={styles.scoreBlock}>
                    <Text style={[styles.score, { color: meta.score }]}>{score}</Text>
                    <Text style={styles.scoreLabel}>TRUST SCORE</Text>
                  </View>
                </Pressable>
              </SwipeableRow>
            );
          }}
        />
      )}

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

// Per-verdict chip + score styling.
function verdictMeta(v: Verdict): {
  label: string;
  chipBg: string;
  chipText: string;
  score: string;
} {
  switch (v) {
    case "Looks Legit":
      return { label: "LEGIT", chipBg: colors.legitContainer, chipText: colors.onLegitContainer, score: colors.legit };
    case "Suspicious":
      return { label: "SUSPICIOUS", chipBg: colors.suspiciousContainer, chipText: colors.onSuspiciousContainer, score: colors.suspicious };
    case "High Risk":
      return { label: "HIGH RISK", chipBg: colors.highRiskContainer, chipText: colors.onHighRiskContainer, score: colors.highRisk };
    default:
      return { label: "NOT ENOUGH INFO", chipBg: colors.unknownContainer, chipText: colors.onUnknownContainer, score: colors.unknown };
  }
}

// The "source" line — the merchant/host the listing lives on, derived from the
// scanned URL (e.g. "lazada.com.ph", "shopee.ph", "amazon.com").
function sourceLabel(target: string): string {
  try {
    const withScheme = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    return new URL(withScheme).hostname.replace(/^www\./i, "");
  } catch {
    return target;
  }
}

// A human-readable product name. `product_name` is the raw URL, so we mine the
// stored response's source titles (e.g. "Lazada listing: UGREEN Pouch Bag") for
// a real title. Falls back to the host when nothing readable is available.
function productName(scan: RecentScan): string {
  const fromResponse = extractTitle(scan.response);
  if (fromResponse) return fromResponse;
  return sourceLabel(scan.product_name);
}

function extractTitle(response: ScanResponse | undefined): string | null {
  const sources = response?.sources ?? [];
  // Listing (price_sanity) sources carry the product title; check those first,
  // then any other source as a fallback.
  const ordered = [...sources].sort(
    (a, b) =>
      (b.signal_type === "price_sanity" ? 1 : 0) -
      (a.signal_type === "price_sanity" ? 1 : 0),
  );
  for (const s of ordered) {
    const t = cleanTitle(s.title);
    if (t) return t;
  }
  return null;
}

// Source titles look like "Lazada listing: <title>", "TikTok Shop: <title>",
// "Lazada seller: <name>", or bare "Shopee listing 123". Strip the marketplace
// prefix and reject the label-only / id-only forms.
function cleanTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  const colon = raw.indexOf(": ");
  const t = (colon >= 0 ? raw.slice(colon + 2) : raw).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return null;
  if (/no title|no name|unknown/i.test(t)) return null;
  // Bare "Lazada listing 123" / "Shopee shop 456" with no real title.
  if (/^(lazada|shopee|tiktok|temu|amazon|ebay|instagram|facebook)\b.*\b(listing|seller|shop|product|profile)\b/i.test(t)) {
    return null;
  }
  return t;
}

// Buckets scans into date sections: Today, Yesterday, then exact dates
// ("OCT 24, 2023"). Assumes `scans` is sorted newest-first.
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
    else {
      title = new Date(s.scanned_at)
        .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase();
    }
    push(title, s);
  }

  return order.map((title) => ({ title, data: buckets[title] }));
}

const CARD_BG = "#F3F1FB"; // light lavender — echoes the reference on a white bg

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
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  filterTextActive: { color: colors.onPrimary },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
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
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_BG,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    ...elevation.card,
  },
  cardSelected: {
    backgroundColor: colors.primaryFixed,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  checkbox: { marginRight: spacing.xs },
  cardBody: { flex: 1, gap: 6 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "800",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
  },
  sourceLabel: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 1,
  },
  productName: {
    ...typography.bodyMd,
    color: colors.text,
  },
  scoreBlock: { alignItems: "flex-end", minWidth: 64 },
  score: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
    fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  scoreLabel: {
    fontSize: 8,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    color: colors.textDim,
    letterSpacing: 0.6,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: "#FFFFFF",
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
  deleteButtonDisabled: { backgroundColor: colors.textDim },
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
  emptyBody: { ...typography.bodyMd, color: colors.textMuted, textAlign: "center" },
});
