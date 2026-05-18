import { StyleSheet, Text, View } from "react-native";
import type { Verdict } from "@sus/shared";
import { verdictColor } from "../theme";

interface Props {
  verdict: Verdict;
  size?: "sm" | "md";
}

export function VerdictBadge({ verdict, size = "md" }: Props) {
  const color = verdictColor(verdict);
  const small = size === "sm";
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: `${color}22`,
          borderColor: color,
          paddingVertical: small ? 2 : 6,
          paddingHorizontal: small ? 8 : 12,
        },
      ]}
    >
      <Text style={[styles.label, { color, fontSize: small ? 11 : 13 }]}>
        {verdict}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  label: {
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
