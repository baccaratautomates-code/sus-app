import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, elevation, radius, spacing, typography } from "../theme";

// In-app confirmation / notice dialog. Replaces the browser-native
// window.confirm/alert (ugly, breaks out of the app's look) and React Native's
// Alert (a no-op on react-native-web). Renders the same on web and native.
//
// Driven by a parent that holds the open/closed state; see HistoryScreen for
// the promise-based askConfirm()/showNotice() helpers that wrap it.
export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string; // default "Delete"
  cancelLabel?: string; // default "Cancel"
  destructive?: boolean; // red confirm button (default true)
  noticeOnly?: boolean; // single "OK" button — for error notices, no cancel
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  noticeOnly = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      {/* Tapping the dimmed backdrop cancels. The inner Pressable absorbs taps
          so pressing the card itself doesn't dismiss. */}
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={styles.actions}>
            {noticeOnly ? (
              <Pressable
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.btn,
                  styles.primaryBtn,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.primaryText}>OK</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={onCancel}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.cancelBtn,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={styles.cancelText}>{cancelLabel}</Text>
                </Pressable>
                <Pressable
                  onPress={onConfirm}
                  style={({ pressed }) => [
                    styles.btn,
                    destructive ? styles.destructiveBtn : styles.primaryBtn,
                    { opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={destructive ? styles.destructiveText : styles.primaryText}>
                    {confirmLabel}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 28, 33, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
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
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  btn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 92,
  },
  cancelBtn: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  cancelText: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  primaryBtn: {
    backgroundColor: colors.primary,
  },
  primaryText: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  destructiveBtn: {
    backgroundColor: colors.highRisk,
  },
  destructiveText: {
    ...typography.labelMd,
    color: "#fff",
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
});
