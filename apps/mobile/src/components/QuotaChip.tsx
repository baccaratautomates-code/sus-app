import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { nextQuotaResetLabel } from "../store";
import { colors, radius, spacing, typography } from "../theme";

// Single quota chip. For free users it crossfades every 5s between the
// scans-left message and an upgrade prompt, and the whole chip taps through to
// the Paywall. Pro/Unlimited users get a static, non-interactive "Unlimited".
export function QuotaChip({
  scansLeft,
  onUpgrade,
}: {
  scansLeft: number;
  onUpgrade: () => void;
}) {
  const unlimited = scansLeft < 0;
  const messages = unlimited
    ? ["Unlimited"]
    : [
        `${scansLeft} ${scansLeft === 1 ? "scan" : "scans"} left · ${nextQuotaResetLabel()}`,
        "Upgrade to Pro →",
      ];

  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (messages.length < 2) return;
    const interval = setInterval(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: false,
      }).start(() => {
        setIdx((i) => (i + 1) % 2);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }).start();
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [unlimited, opacity, messages.length]);

  const body = (
    <Animated.Text style={[styles.text, { opacity }]} numberOfLines={1}>
      {messages[idx % messages.length]}
    </Animated.Text>
  );

  if (unlimited) {
    return <View style={styles.pill}>{body}</View>;
  }
  return (
    <Pressable onPress={onUpgrade} style={styles.pill} hitSlop={8}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.primaryFixed,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    alignSelf: "flex-end",
  },
  text: {
    ...typography.labelMd,
    color: colors.primary,
  },
});
