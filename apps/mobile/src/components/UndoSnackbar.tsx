import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, elevation, radius, spacing, typography } from "../theme";

// Floating "Deleted · Undo" bar shown after an instant delete. Sits above the
// bottom tab bar. The parent holds the timer that commits the delete when the
// undo window lapses; tapping UNDO restores the removed rows.
export function UndoSnackbar({
  visible,
  message,
  onUndo,
}: {
  visible: boolean;
  message: string;
  onUndo: () => void;
}) {
  if (!visible) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <Text style={styles.message} numberOfLines={1}>
          {message}
        </Text>
        <Pressable onPress={onUndo} hitSlop={8}>
          <Text style={styles.undo}>UNDO</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 84, // clear the bottom tab bar
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
    backgroundColor: colors.text,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    width: "100%",
    maxWidth: 420,
    ...elevation.card,
  },
  message: {
    ...typography.bodyMd,
    color: "#FFFFFF",
    flexShrink: 1,
  },
  undo: {
    ...typography.labelMd,
    color: colors.primaryFixed,
    fontWeight: "800",
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.5,
  },
});
