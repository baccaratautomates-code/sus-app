import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { requestScan } from "../store";
import { colors } from "../theme";
import type { ScreenProps } from "../navigation";

const STATUSES = [
  "Checking seller history…",
  "Scanning reviews…",
  "Cross-referencing scam databases…",
  "Validating price against market…",
] as const;

const STATUS_INTERVAL_MS = 2000;
const SCAN_TIMEOUT_MS = 30_000;

type ScanState = { kind: "loading" } | { kind: "error"; message: string };

export default function LoadingScreen({ navigation, route }: ScreenProps<"Loading">) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [state, setState] = useState<ScanState>({ kind: "loading" });
  const slide = useRef(new Animated.Value(0)).current;
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runScan = useCallback(async () => {
    setState({ kind: "loading" });
    setStatusIdx(0);

    // Cancel any in-flight attempt before starting a new one.
    abortRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const controller = new AbortController();
    abortRef.current = controller;
    timeoutRef.current = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const result = await requestScan(route.params.url, controller.signal);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      navigation.replace("Verdict", { result });
    } catch (err) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const isAbort =
        err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"));
      const message = isAbort
        ? "The scan took longer than 30 seconds. The server may be busy — please try again."
        : `Couldn't reach the scan service. ${(err as Error).message}`;
      setState({ kind: "error", message });
    }
  }, [navigation, route.params.url]);

  // Animate status text + progress bar only while loading.
  useEffect(() => {
    if (state.kind !== "loading") return;

    const tick = setInterval(
      () => setStatusIdx((i) => (i + 1) % STATUSES.length),
      STATUS_INTERVAL_MS,
    );
    const animation = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      clearInterval(tick);
      animation.stop();
    };
  }, [state.kind, slide]);

  // Kick off the scan on mount. On unmount, abort the in-flight fetch.
  useEffect(() => {
    runScan();
    return () => {
      abortRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // runScan is stable for a given route.params.url; intentional dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 240],
  });

  if (state.kind === "error") {
    return (
      <View style={styles.container}>
        <Text style={styles.errorHeading}>Couldn't get a verdict</Text>
        <Text style={styles.errorMessage}>{state.message}</Text>
        <Pressable
          onPress={runScan}
          style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.75 : 1 }]}
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} style={styles.cancel}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Investigating…</Text>

      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { transform: [{ translateX }] }]} />
      </View>

      <Text style={styles.status}>{STATUSES[statusIdx]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  heading: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 40,
  },
  barTrack: {
    width: 240,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceElevated,
    overflow: "hidden",
    marginBottom: 28,
  },
  barFill: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  status: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: "center",
    minHeight: 22,
  },
  errorHeading: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  errorMessage: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 22,
  },
  retry: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    marginBottom: 12,
  },
  retryLabel: { color: "#1A1A1F", fontWeight: "700", fontSize: 16 },
  cancel: { paddingVertical: 10 },
  cancelLabel: { color: colors.textMuted, fontSize: 14 },
});
