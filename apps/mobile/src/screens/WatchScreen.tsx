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
import { ConfirmModal } from "../components/ConfirmModal";
import { ScanThumbnail } from "../components/ScanThumbnail";
import { VerdictBadge } from "../components/VerdictBadge";
import {
  deleteWatch,
  dismissWatchAlert,
  fetchWatches,
  type Watch,
} from "../store";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
  verdictColor,
} from "../theme";
import type { ScreenProps } from "../navigation";

export default function WatchScreen({ navigation }: ScreenProps<"Watch">) {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Watch the user is about to unwatch — confirmation modal is open when set.
  const [unwatchTarget, setUnwatchTarget] = useState<Watch | null>(null);

  const load = useCallback(async () => {
    const rows = await fetchWatches();
    setWatches(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Tap a row → open the latest Verdict for that watch. If there's a pending
  // alert, dismiss it server-side first so the badge clears on next refresh.
  const openWatch = async (w: Watch) => {
    if (w.pendingAlert) {
      dismissWatchAlert(w.id).catch(() => {});
    }
    navigation.navigate("Verdict", { result: w.lastResponse, from: "history" });
  };

  const confirmUnwatch = async () => {
    if (!unwatchTarget) return;
    const id = unwatchTarget.id;
    setUnwatchTarget(null);
    // Optimistic remove. fetchWatches() in the next focus will reconcile.
    setWatches((prev) => prev.filter((w) => w.id !== id));
    await deleteWatch(id);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <BrandMark />
      </View>

      {loading ? (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : watches.length === 0 ? (
        <View style={styles.centerWrap}>
          <MaterialIcons name="visibility" size={56} color={colors.textDim} />
          <Text style={styles.emptyTitle}>Nothing watched yet</Text>
          <Text style={styles.emptyBody}>
            Tap the Watch button on any verdict to monitor that listing. Sus
            re-checks it every day and alerts you if new red flags appear.
          </Text>
        </View>
      ) : (
        <FlatList
          data={watches}
          keyExtractor={(w) => w.id}
          contentContainerStyle={styles.list}
          onRefresh={onRefresh}
          refreshing={refreshing}
          renderItem={({ item }) => (
            <WatchRow
              watch={item}
              onPress={() => openWatch(item)}
              onUnwatch={() => setUnwatchTarget(item)}
            />
          )}
        />
      )}

      <BottomNav active="watch" />

      <ConfirmModal
        visible={!!unwatchTarget}
        title="Stop watching?"
        message={
          unwatchTarget
            ? `Sus will stop re-checking "${unwatchTarget.label}" and you won't get further alerts about it.`
            : ""
        }
        confirmLabel="Stop watching"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmUnwatch}
        onCancel={() => setUnwatchTarget(null)}
      />
    </SafeAreaView>
  );
}

interface RowProps {
  watch: Watch;
  onPress: () => void;
  onUnwatch: () => void;
}

function WatchRow({ watch, onPress, onUnwatch }: RowProps) {
  const accent = verdictColor(watch.lastVerdict);
  const alert = watch.pendingAlert;

  return (
    <View
      style={[
        styles.row,
        alert && {
          borderColor: accent,
          borderWidth: 2,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.rowMain,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <ScanThumbnail
          thumbnailUrl={watch.thumbnailUrl}
          url={watch.target}
        />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {watch.label}
          </Text>
          <Text style={styles.rowMeta}>
            {alert
              ? alert.summary
              : `Last checked ${formatRelativeTime(watch.lastCheckedAt)}`}
          </Text>
        </View>
        <VerdictBadge verdict={watch.lastVerdict} size="sm" />
      </Pressable>

      <Pressable
        onPress={onUnwatch}
        hitSlop={8}
        style={({ pressed }) => [
          styles.unwatchBtn,
          { opacity: pressed ? 0.5 : 1 },
        ]}
      >
        <MaterialIcons
          name="visibility-off"
          size={18}
          color={colors.textDim}
        />
      </Pressable>
    </View>
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
    overflow: "hidden",
    ...elevation.card,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowBody: { flex: 1, paddingVertical: spacing.sm, gap: 2 },
  rowTitle: {
    ...typography.bodyMd,
    color: colors.text,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "400",
    fontFamily: "Inter_400Regular",
  },
  unwatchBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderLeftWidth: 1,
    borderLeftColor: colors.surfaceContainerHighest,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
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
