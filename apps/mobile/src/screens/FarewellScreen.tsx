import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../context/AuthContext";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";
import type { ScreenProps } from "../navigation";

// Post-deletion farewell. Reached only via SettingsScreen.onConfirmDelete
// after deleteAccount() succeeds. The local Supabase session is still
// populated when we land here (we deliberately defer signOutLocal until the
// user dismisses this screen) so the navigator doesn't auto-kick to Auth and
// the user gets a moment of closure instead of an abrupt redirect.
//
// Tapping "Sign back in" calls signOutLocal() which clears the local JWT,
// which fires onAuthStateChange → session becomes null → Root re-renders
// the Auth stack.
export default function FarewellScreen(_props: ScreenProps<"Farewell">) {
  const { signOutLocal } = useAuth();

  const onDone = async () => {
    // Local-scope clear because server-side auth.users is already gone — a
    // global signOut here would 403 against Supabase's logout endpoint.
    await signOutLocal();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <BrandMark />
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <MaterialIcons
            name="waving-hand"
            size={56}
            color={colors.primary}
          />
        </View>

        <Text style={styles.title}>We'll miss you.</Text>
        <Text style={styles.subtitle}>
          Your account, scan history, and watched listings have been deleted.
          Nothing is left on our servers.
        </Text>

        <Text style={styles.body2}>
          If you change your mind, you can come back anytime — signing in with
          the same email starts a fresh account. No data follows you over.
        </Text>

        <Pressable
          onPress={onDone}
          style={({ pressed }) => [
            styles.cta,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.ctaLabel}>Sign back in</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Thanks for trying Sus. If something pushed you away, we'd love to
          hear it — reach out to feedback@sus.app.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.full,
    backgroundColor: colors.primaryFixed,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.text,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  body2: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  cta: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    alignSelf: "stretch",
    alignItems: "center",
    ...elevation.card,
  },
  ctaLabel: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: "Inter_800ExtraBold",
  },
  footnote: {
    ...typography.caption,
    color: colors.textDim,
    textAlign: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    fontStyle: "italic",
  },
});
