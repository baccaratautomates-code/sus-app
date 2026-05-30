import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { navigationRef } from "../navigation";
import { colors, spacing, typography } from "../theme";

interface Props {
  size?: number;
}

// Shared Sus icon + wordmark used in every authed-screen header. Tapping it
// navigates back to Home so the brand doubles as a "back to scan" affordance.
// Uses the imperative navigationRef instead of a hook so individual screens
// don't have to forward their navigation prop.
export function BrandMark({ size = 28 }: Props) {
  const onPress = () => {
    if (navigationRef.isReady()) navigationRef.navigate("Home");
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel="Sus — go to scan"
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <MaterialIcons name="verified-user" size={size} color={colors.primary} />
      <Text style={[styles.name, { fontSize: Math.round(size * 0.93) }]}>
        Sus
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  name: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: "900",
    fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
});
