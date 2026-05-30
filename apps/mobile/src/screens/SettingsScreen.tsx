import { MaterialIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomNav } from "../components/BottomNav";
import { UserAvatar } from "../components/UserAvatar";
import { useAuth } from "../context/AuthContext";
import { usePro } from "../context/ProContext";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";
import type { ScreenProps } from "../navigation";

export default function SettingsScreen({ navigation }: ScreenProps<"Settings">) {
  const { user, signOut } = useAuth();
  const { isPro } = usePro();

  // Pretty name: prefer the Google profile name, then fall back to the part of
  // the email before "@" so email-only users see something friendlier than the
  // raw address.
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "Account";

  const onSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          // AuthProvider's onAuthStateChange clears the session, Root re-
          // renders the Auth stack automatically. No imperative nav needed.
        },
      },
    ]);
  };

  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? "dev";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <MaterialIcons name="verified-user" size={28} color={colors.primary} />
          <Text style={styles.brandName}>Sus</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileCard}>
          <UserAvatar size={72} />
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          {user?.email && (
            <Text style={styles.email} numberOfLines={1}>
              {user.email}
            </Text>
          )}
          <View
            style={[
              styles.tierPill,
              isPro ? styles.tierPillPro : styles.tierPillFree,
            ]}
          >
            <Text
              style={[
                styles.tierLabel,
                { color: isPro ? colors.onPrimary : colors.primary },
              ]}
            >
              {isPro ? "PRO" : "FREE"}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionHeading}>ACCOUNT</Text>
        <View style={styles.list}>
          <Row
            icon="workspace-premium"
            label={isPro ? "Manage subscription" : "Upgrade to Pro"}
            onPress={() => navigation.navigate("Paywall")}
          />
        </View>

        <Text style={styles.sectionHeading}>ABOUT</Text>
        <View style={styles.list}>
          <Row
            icon="description"
            label="Terms of Service"
            onPress={() =>
              Linking.openURL("https://sus-app-flax.vercel.app/terms")
            }
            external
          />
          <Row
            icon="privacy-tip"
            label="Privacy Policy"
            onPress={() =>
              Linking.openURL("https://sus-app-flax.vercel.app/privacy")
            }
            external
          />
          <Row icon="info" label={`Version ${appVersion}`} />
        </View>

        <Pressable
          onPress={onSignOut}
          style={({ pressed }) => [
            styles.signOutBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="logout" size={20} color={colors.highRisk} />
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <BottomNav active="settings" />
    </SafeAreaView>
  );
}

interface RowProps {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress?: () => void;
  external?: boolean;
}

function Row({ icon, label, onPress, external }: RowProps) {
  const trailing = external ? "open-in-new" : "chevron-right";
  const content = (
    <View style={styles.row}>
      <MaterialIcons name={icon} size={20} color={colors.primary} />
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress && (
        <MaterialIcons name={trailing} size={20} color={colors.textMuted} />
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
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
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brandName: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  profileCard: {
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...elevation.card,
  },
  name: {
    ...typography.headlineMdMobile,
    color: colors.text,
    marginTop: spacing.sm,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  email: {
    ...typography.bodyMd,
    color: colors.textMuted,
  },
  tierPill: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  tierPillPro: {
    backgroundColor: colors.primary,
  },
  tierPillFree: {
    backgroundColor: colors.primaryContainer + "20",
    borderWidth: 1,
    borderColor: colors.primaryContainer,
  },
  tierLabel: {
    ...typography.labelMd,
    letterSpacing: 1,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  sectionHeading: {
    ...typography.labelMd,
    color: colors.textMuted,
    letterSpacing: 1.2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  list: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHighest,
  },
  rowLabel: {
    ...typography.bodyMd,
    color: colors.text,
    flex: 1,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.highRiskContainer,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  signOutLabel: {
    ...typography.labelMd,
    color: colors.highRisk,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
});
