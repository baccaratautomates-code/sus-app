import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, elevation, radius, spacing, typography } from "../theme";

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // When true, the confirm button uses the High Risk red palette so the user
  // sees the action is destructive. The Cancel button is always the safe path.
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// In-app confirmation dialog. Replaces Alert.alert + window.confirm so both
// platforms render the same Sus-styled card (rounded surface, primary purple
// or High Risk red on the action button, muted backdrop). Tapping the backdrop
// counts as Cancel — matches iOS sheet conventions.
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      // Web-only: hide the modal's container from accessibility tree while
      // hidden so screen readers don't announce stale dialog content.
      hardwareAccelerated
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Inner pressable swallows taps so clicking inside the card doesn't
            dismiss. Empty onPress is intentional — the outer Pressable on the
            backdrop is what closes the modal. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.cancelBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.confirmBtn,
                destructive && styles.confirmBtnDestructive,
                { opacity: pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={styles.confirmLabel}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 28, 33, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...elevation.card,
  },
  title: {
    ...typography.headlineMdMobile,
    color: colors.text,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  message: {
    ...typography.bodyMd,
    color: colors.textMuted,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnDestructive: {
    backgroundColor: colors.highRisk,
  },
  confirmLabel: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
});
