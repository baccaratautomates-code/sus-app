import { forwardRef, useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors, radius, spacing, typography } from "../theme";

interface Props extends Omit<TextInputProps, "style"> {
  label: string;
  // Color painted behind the floating label so it visually "notches" the
  // input's top border. Must match the parent screen's background. Defaults
  // to colors.background which is correct for full-bleed screens.
  surfaceColor?: string;
}

// Material 3 outlined text field with a floating label. At rest, the label
// sits inside the input acting as a placeholder. On focus (or as soon as the
// field has any value), it animates up to the top border, notching through
// the stroke, and the border tints primary purple.
//
// Implementation note: useNativeDriver: false because the animation drives
// `top` and `fontSize` — both layout properties Native driver doesn't
// support. JS-driven animation is fast enough for a 160ms transition.
export const LabeledInput = forwardRef<TextInput, Props>(function LabeledInput(
  {
    label,
    onFocus,
    onBlur,
    value,
    defaultValue,
    placeholder,
    surfaceColor = colors.background,
    ...rest
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const hasValue = ((value ?? defaultValue ?? "") as string).length > 0;
  // "Floating" = label has lifted to the top. True when user is focused OR
  // the field already has a value (so it doesn't drop back over typed text).
  const floating = focused || hasValue;

  const anim = useRef(new Animated.Value(floating ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: floating ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [floating, anim]);

  const borderColor = focused ? colors.primary : colors.outlineVariant;

  // Layout: label slides from inside the field (top: 18) up to sit on the
  // border (top: -9). Font shrinks from input size (16) to label size (13).
  const labelTop = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, -9],
  });
  const labelFontSize = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 13],
  });
  const labelColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      colors.textMuted,
      focused ? colors.primary : colors.textMuted,
    ],
  });
  // Background swatch fades in during the second half of the animation, so
  // it only appears once the label has cleared the field interior and
  // reached the border — avoids a colored block visibly sliding down.
  const swatchOpacity = anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View style={styles.container}>
      <TextInput
        ref={ref}
        {...rest}
        value={value}
        defaultValue={defaultValue}
        // Hide the auxiliary placeholder while the label sits inside — the
        // label IS the placeholder there. Once it floats up, the placeholder
        // can appear as the in-field hint (e.g. "you@example.com").
        placeholder={floating ? placeholder : ""}
        placeholderTextColor={colors.textDim}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, { borderColor }]}
      />
      {/* Floating label. pointerEvents=none so taps pass through to TextInput. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.labelWrap, { top: labelTop }]}
      >
        {/* Background swatch sits behind the text and fades in only at the
            top position, so the unfocused-empty state shows the label as
            plain text inside the field with no visible swatch. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: surfaceColor, opacity: swatchOpacity },
          ]}
        />
        <Animated.Text
          style={[styles.label, { fontSize: labelFontSize, color: labelColor }]}
        >
          {label}
        </Animated.Text>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "relative",
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    // Extra top padding so the cursor + value sit comfortably below the
    // floated label and don't overlap it.
    paddingTop: spacing.md + 4,
    paddingBottom: spacing.md,
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  labelWrap: {
    position: "absolute",
    left: spacing.md,
    // Horizontal padding so the swatch extends slightly past the text on
    // each side — without it the border line would peek through letters
    // with narrow glyphs (e.g. the "i" in Email).
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typography.labelMd,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
});
