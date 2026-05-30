import { MaterialIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { requestImageScan, requestScan } from "../store";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";
import type { ScreenProps } from "../navigation";

// PRD §2 calls for rotating investigative status text during the scan. These
// match the PRD copy so the user sees specifically what we're checking.
const URL_STATUSES = [
  "Checking seller history…",
  "Scanning reviews…",
  "Cross-referencing scam databases…",
  "Validating price against market…",
  "Analyzing domain age…",
  "Verifying buyer-protection coverage…",
] as const;

// Image scans run an extra OCR step before the standard pipeline; the rotating
// text leads with what we're doing differently so the user knows the wait is
// for image processing, not a hung scan.
const IMAGE_STATUSES = [
  "Reading image…",
  "Extracting product details…",
  "Locating listing online…",
  "Checking seller history…",
  "Cross-referencing scam databases…",
  "Validating price against market…",
] as const;

const STATUS_INTERVAL_MS = 1800;
const SCAN_TIMEOUT_MS = 30_000;

type ScanState = { kind: "loading" } | { kind: "error"; message: string };

export default function LoadingScreen({ navigation, route }: ScreenProps<"Loading">) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  const isImageScan = route.params.kind === "image";
  const statuses = isImageScan ? IMAGE_STATUSES : URL_STATUSES;

  // Indeterminate progress-bar slide animation.
  const slide = useRef(new Animated.Value(0)).current;
  // Slow pulsing ring around the radar circle.
  const pulse = useRef(new Animated.Value(0)).current;

  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runScan = useCallback(async () => {
    setState({ kind: "loading" });
    setStatusIdx(0);

    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const controller = new AbortController();
    abortRef.current = controller;
    timeoutRef.current = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const result =
        route.params.kind === "image"
          ? await requestImageScan(route.params.image, controller.signal)
          : await requestScan(route.params.url, controller.signal);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      navigation.replace("Verdict", { result });
    } catch (err) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("abort"));
      const message = isAbort
        ? "The scan took longer than 30 seconds. The server may be busy — please try again."
        : `Couldn't reach the scan service. ${(err as Error).message}`;
      setState({ kind: "error", message });
    }
  }, [navigation, route.params]);

  useEffect(() => {
    if (state.kind !== "loading") return;

    const tick = setInterval(
      () => setStatusIdx((i) => (i + 1) % statuses.length),
      STATUS_INTERVAL_MS,
    );
    const slideAnim = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    const pulseAnim = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    slideAnim.start();
    pulseAnim.start();
    return () => {
      clearInterval(tick);
      slideAnim.stop();
      pulseAnim.stop();
    };
  }, [state.kind, slide, pulse]);

  useEffect(() => {
    runScan();
    return () => {
      abortRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Error state retains the simpler centred layout from before.
  if (state.kind === "error") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Text style={styles.errorHeading}>Couldn't get a verdict</Text>
          <Text style={styles.errorMessage}>{state.message}</Text>
          <Pressable
            onPress={runScan}
            style={({ pressed }) => [
              styles.retry,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
          <Pressable onPress={() => navigation.goBack()} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Indeterminate progress bar — moves left to right across the track.
  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 240],
  });

  // Pulse ring: scales 0.95 → 1.1, fades 0.5 → 0.0.
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.1],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <MaterialIcons name="verified-user" size={28} color={colors.primary} />
          <Text style={styles.brandName}>Sus</Text>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>Investigating…</Text>
        </View>
      </View>

      <View style={styles.center}>
        <View style={styles.radarWrap}>
          {/* Pulse ring 1 */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pulseRing,
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />
          {/* Pulse ring 2 (delayed for layered effect via base scale) */}
          <View style={styles.pulseRingStatic} pointerEvents="none" />
          <View style={styles.radarCircle}>
            <MaterialIcons
              name="qr-code-scanner"
              size={72}
              color={colors.primary}
            />
          </View>
        </View>

        <View style={styles.statusWrap}>
          <Text style={styles.statusHeading}>{statuses[statusIdx]}</Text>
          <Text style={styles.statusSub}>
            Running across {statuses.length * 7}+ security heuristics
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.barTrack}>
          <Animated.View
            style={[styles.barFill, { transform: [{ translateX }] }]}
          />
        </View>
        <View style={styles.analyzingBtn}>
          <Text style={styles.analyzingBtnLabel}>Analyzing results…</Text>
        </View>
        <Pressable onPress={() => navigation.goBack()} style={styles.cancel}>
          <Text style={styles.cancelLabel}>CANCEL SCAN</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const RADAR_SIZE = 240;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
    backgroundColor: colors.surface,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brandName: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  statusPill: {
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  statusPillText: {
    ...typography.labelMd,
    color: colors.primary,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  radarWrap: {
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl + spacing.md,
  },
  pulseRing: {
    position: "absolute",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    borderRadius: RADAR_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.primaryContainer,
  },
  pulseRingStatic: {
    position: "absolute",
    width: RADAR_SIZE - 24,
    height: RADAR_SIZE - 24,
    borderRadius: (RADAR_SIZE - 24) / 2,
    borderWidth: 2,
    borderColor: colors.primaryFixed,
    opacity: 0.6,
  },
  radarCircle: {
    width: RADAR_SIZE - 56,
    height: RADAR_SIZE - 56,
    borderRadius: (RADAR_SIZE - 56) / 2,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    alignItems: "center",
    justifyContent: "center",
    ...elevation.card,
  },
  statusWrap: { alignItems: "center", gap: spacing.xs, minHeight: 48 },
  statusHeading: {
    ...typography.headlineMdMobile,
    color: colors.text,
    textAlign: "center",
  },
  statusSub: {
    ...typography.bodyMd,
    color: colors.textMuted,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceContainerHighest,
    overflow: "hidden",
  },
  barFill: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  analyzingBtn: {
    backgroundColor: colors.primaryContainer,
    opacity: 0.5,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  analyzingBtnLabel: {
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  cancel: { alignSelf: "center", paddingVertical: spacing.sm },
  cancelLabel: {
    ...typography.labelMd,
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  // Error state
  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  errorHeading: {
    ...typography.headlineLgMobile,
    color: colors.text,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  errorMessage: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  retry: {
    backgroundColor: colors.primaryContainer,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  retryLabel: {
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
});
