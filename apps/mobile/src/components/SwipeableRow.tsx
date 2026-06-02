import { useRef, type ReactNode } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme";

// Swipe-left-or-right-to-delete, built on RN's core PanResponder + Animated so
// it needs no native gesture library and works with touch (mobile) and
// mouse-drag (web). Dragging a row past the threshold in either direction fires
// onSwipeDelete (the parent shows a confirm); the row always springs back so
// the confirm — not the gesture alone — commits the delete.
//
// `enabled` is false in select mode, where horizontal drags would fight the
// checkboxes; there the row is a plain View.

const THRESHOLD = 96; // px of horizontal travel before a swipe counts as delete

export function SwipeableRow({
  children,
  enabled,
  onSwipeDelete,
}: {
  children: ReactNode;
  enabled: boolean;
  onSwipeDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  // PanResponder is created once; read the latest props via refs.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onDeleteRef = useRef(onSwipeDelete);
  onDeleteRef.current = onSwipeDelete;

  const pan = useRef(
    PanResponder.create({
      // Don't claim taps (let the card's Pressable handle them); only take over
      // once the move is clearly horizontal, so vertical list scroll still works.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        enabledRef.current &&
        Math.abs(g.dx) > 12 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        translateX.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        const passed = Math.abs(g.dx) >= THRESHOLD;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 0,
        }).start();
        if (passed) onDeleteRef.current();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: false,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  if (!enabled) {
    return <View style={styles.wrap}>{children}</View>;
  }

  return (
    <View style={styles.wrap}>
      {/* Red delete affordance revealed behind the row as it slides. */}
      <View style={styles.deleteBg} pointerEvents="none">
        <MaterialIcons name="delete-outline" size={22} color="#fff" />
        <MaterialIcons name="delete-outline" size={22} color="#fff" />
      </View>
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...pan.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  deleteBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.highRisk,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
});
