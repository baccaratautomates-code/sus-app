import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors, radius, typography } from "../theme";

interface Props {
  size?: number;
  onPress?: () => void;
}

// Reusable avatar — pulls from the Google avatar URL surfaced by Supabase
// in user_metadata when the user signed in via Google. For email/password
// sign-ups (no Google) we fall back to a colored circle with the email's
// first letter, which is the same pattern Gmail / GitHub use.
export function UserAvatar({ size = 36, onPress }: Props) {
  const { user } = useAuth();

  // Supabase normalizes the Google avatar URL into user_metadata.avatar_url
  // (and also exposes picture for backwards-compat). Email-only users have
  // neither and fall through to the initial.
  const avatarUrl =
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined);

  const initial =
    (user?.email?.[0] ?? user?.user_metadata?.name?.[0] ?? "?").toUpperCase();

  const inner = avatarUrl ? (
    <Image
      source={{ uri: avatarUrl }}
      style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
    />
  ) : (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
        {initial}
      </Text>
    </View>
  );

  if (!onPress) return inner;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      accessibilityRole="button"
      accessibilityLabel="Open profile and settings"
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: {
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  fallback: {
    backgroundColor: colors.primaryContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
});
