import { MaterialIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../supabase";
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";

type Mode = "sign-in" | "sign-up";

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  const onSubmitEmail = async () => {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    if (isSignUp && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy("email");
    try {
      const { error: authError } = isSignUp
        ? await supabase.auth.signUp({
            email: trimmedEmail,
            password,
          })
        : await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          });
      if (authError) {
        setError(authError.message);
      } else if (isSignUp) {
        Alert.alert(
          "Check your inbox",
          "We sent a confirmation link to your email. After confirming, sign in below.",
        );
        setMode("sign-in");
        setPassword("");
      }
      // Successful sign-in: AuthProvider's onAuthStateChange handles routing.
    } finally {
      setBusy(null);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setBusy("google");
    try {
      // For native, this would need a custom redirect URI handler. For the
      // Vercel web demo this opens the Google consent page and Supabase
      // catches the callback via detectSessionInUrl.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo:
            Platform.OS === "web" && typeof window !== "undefined"
              ? window.location.origin
              : undefined,
        },
      });
      if (oauthError) setError(oauthError.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <MaterialIcons
              name="verified-user"
              size={36}
              color={colors.primary}
            />
            <Text style={styles.brandName}>Sus</Text>
          </View>

          <Text style={styles.heading}>
            {isSignUp ? "Create your account" : "Welcome back"}
          </Text>
          <Text style={styles.subheading}>
            {isSignUp
              ? "3 free scans every month. No credit card."
              : "Sign in to keep your scan history in sync."}
          </Text>

          <Pressable
            onPress={onGoogle}
            disabled={busy !== null}
            style={({ pressed }) => [
              styles.googleBtn,
              { opacity: pressed || busy === "google" ? 0.85 : 1 },
            ]}
          >
            {busy === "google" ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <MaterialIcons name="login" size={20} color={colors.text} />
                <Text style={styles.googleBtnLabel}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder={isSignUp ? "6+ characters" : "Your password"}
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType={isSignUp ? "newPassword" : "password"}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={onSubmitEmail}
              returnKeyType="go"
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={onSubmitEmail}
            disabled={busy !== null}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: pressed || busy === "email" ? 0.85 : 1 },
            ]}
          >
            {busy === "email" ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryBtnLabel}>
                {isSignUp ? "Create account" : "Sign in"}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(isSignUp ? "sign-in" : "sign-up");
              setError(null);
            }}
            hitSlop={8}
            style={styles.switchModeBtn}
          >
            <Text style={styles.switchModeLabel}>
              {isSignUp
                ? "Already have an account? "
                : "Don't have an account? "}
              <Text style={styles.switchModeAccent}>
                {isSignUp ? "Sign in" : "Sign up"}
              </Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing.md,
    justifyContent: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  brandName: {
    ...typography.headlineLgMobile,
    color: colors.primary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  heading: {
    ...typography.headlineLgMobile,
    color: colors.text,
    textAlign: "center",
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
  },
  subheading: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    ...elevation.card,
  },
  googleBtnLabel: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.surfaceContainerHighest,
  },
  dividerLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  inputGroup: { gap: spacing.xs },
  inputLabel: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "600", fontFamily: "Inter_600SemiBold",
  },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  error: {
    ...typography.caption,
    color: colors.highRisk,
    textAlign: "center",
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryBtnLabel: {
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  switchModeBtn: { alignSelf: "center", paddingVertical: spacing.sm },
  switchModeLabel: {
    ...typography.bodyMd,
    color: colors.textMuted,
  },
  switchModeAccent: {
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
});
