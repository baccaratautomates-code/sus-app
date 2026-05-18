import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { mockVerdictFor } from "../store";
import { colors } from "../theme";
import type { ScreenProps } from "../navigation";

const STATUSES = [
  "Checking seller history…",
  "Scanning reviews…",
  "Cross-referencing scam databases…",
  "Validating price against market…",
] as const;

const STATUS_INTERVAL_MS = 2000;
const TOTAL_DURATION_MS = 6000;

export default function LoadingScreen({ navigation, route }: ScreenProps<"Loading">) {
  const [idx, setIdx] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const tick = setInterval(() => {
      setIdx((i) => (i + 1) % STATUSES.length);
    }, STATUS_INTERVAL_MS);

    const animation = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    animation.start();

    const navTimer = setTimeout(() => {
      navigation.replace("Verdict", { result: mockVerdictFor(route.params.url) });
    }, TOTAL_DURATION_MS);

    return () => {
      clearInterval(tick);
      clearTimeout(navTimer);
      animation.stop();
    };
  }, [navigation, route.params.url, slide]);

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 240],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Investigating…</Text>

      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { transform: [{ translateX }] }]} />
      </View>

      <Text style={styles.status}>{STATUSES[idx]}</Text>
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
});
