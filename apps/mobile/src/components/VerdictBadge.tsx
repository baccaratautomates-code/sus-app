import { StyleSheet, Text, View } from "react-native";
import type { Verdict } from "@sus/shared";
import {
  onVerdictContainerColor,
  radius,
  typography,
  verdictContainerColor,
} from "../theme";

interface Props {
  verdict: Verdict;
  size?: "sm" | "md";
}

// Pill-shaped verdict badge per the Stitch design system. Uses the verdict's
// container color as the background and its on-container color as the label.
export function VerdictBadge({ verdict, size = "md" }: Props) {
  const bg = verdictContainerColor(verdict);
  const fg = onVerdictContainerColor(verdict);
  const small = size === "sm";

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          paddingVertical: small ? 4 : 8,
          paddingHorizontal: small ? 10 : 14,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: fg,
            fontSize: small ? 11 : 14,
            lineHeight: small ? 14 : 18,
          },
        ]}
      >
        {verdict.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.full,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.labelMd,
    letterSpacing: 0.5,
    textAlign: "center",
    includeFontPadding: false,
  },
});
