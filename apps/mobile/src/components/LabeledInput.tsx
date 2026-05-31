import { forwardRef, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { colors, radius, spacing, typography } from "../theme";

interface Props extends Omit<TextInputProps, "style"> {
  label: string;
  // Color painted behind the floating label so it visually "notches" the
  // input's top border. Must match the parent screen's background or the
  // label will look like it's sitting on a different surface. Defaults to
  // colors.background which is correct for full-bleed screens.
  surfaceColor?: string;
}

// Material 3 outlined text field. The label sits on the top border with a
// small surface-colored swatch painted behind it so it appears to cut
// through the stroke — matches the screenshot the user shared. Focus state
// uses the primary purple for both border and label.
export const LabeledInput = forwardRef<TextInput, Props>(function LabeledInput(
  { label, onFocus, onBlur, surfaceColor = colors.background, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const borderColor = focused ? colors.primary : colors.outlineVariant;
  const labelColor = focused ? colors.primary : colors.textMuted;

  return (
    <View style={styles.container}>
      <TextInput
        ref={ref}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        placeholderTextColor={colors.textDim}
        style={[styles.input, { borderColor }]}
      />
      {/* Label floats on top of the input's border. pointerEvents=none so
          taps pass through to the TextInput beneath. */}
      <View
        pointerEvents="none"
        style={[styles.labelWrap, { backgroundColor: surfaceColor }]}
      >
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "relative",
    // Top margin gives the floating label room above the input border.
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    // Extra top padding so the cursor + value sit comfortably below the label.
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.md,
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  labelWrap: {
    position: "absolute",
    top: -9,
    left: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typography.labelMd,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
});
