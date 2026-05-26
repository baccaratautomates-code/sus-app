import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { VerdictBadge } from "../components/VerdictBadge";
import { fetchRecentScans, mockState, type RecentScan } from "../store";
import { colors } from "../theme";
import type { ScreenProps } from "../navigation";

export default function HomeScreen({ navigation }: ScreenProps<"Home">) {
  const [url, setUrl] = useState("");
  const [scansLeft, setScansLeft] = useState(mockState.scansLeft);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);

  // Refresh recent scans every time Home regains focus — after a scan completes
  // the user backs out of the Verdict screen, so this is when fresh data lands.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchRecentScans(3).then((scans) => {
        if (!cancelled) setRecentScans(scans);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const onCheck = () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (scansLeft <= 0) {
      navigation.navigate("Paywall");
      return;
    }

    setScansLeft(scansLeft - 1);
    mockState.scansLeft = scansLeft - 1;
    navigation.navigate("Loading", { url: trimmed });
    setUrl("");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Sus</Text>
          <Text style={styles.scansLeft}>{scansLeft} scans left this month</Text>
        </View>

        <View style={styles.inputCard}>
          <Text style={styles.inputLabel}>Paste a link to check</Text>
          <TextInput
            style={styles.input}
            placeholder="https://"
            placeholderTextColor={colors.textDim}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={onCheck}
          />
          <Pressable
            onPress={onCheck}
            style={({ pressed }) => [
              styles.cta,
              { opacity: pressed || !url.trim() ? 0.7 : 1 },
            ]}
          >
            <Text style={styles.ctaLabel}>Check it</Text>
          </Pressable>
        </View>

        <View style={styles.recentSection}>
          <Text style={styles.sectionHeading}>Recent scans</Text>
          {recentScans.length === 0 ? (
            <Text style={styles.recentEmpty}>No scans yet — paste a link above to get started.</Text>
          ) : (
            recentScans.map((scan) => (
              <View key={scan.id} style={styles.recentRow}>
                <Text style={styles.recentName} numberOfLines={1}>
                  {scan.product_name}
                </Text>
                <VerdictBadge verdict={scan.verdict} size="sm" />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 20, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  title: { color: colors.text, fontSize: 36, fontWeight: "700" },
  scansLeft: { color: colors.textMuted, fontSize: 13 },
  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 32,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 16,
  },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaLabel: { color: "#1A1A1F", fontWeight: "700", fontSize: 16 },
  recentSection: { gap: 12 },
  sectionHeading: {
    color: colors.textMuted,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  recentName: { color: colors.text, fontSize: 15, flex: 1 },
  recentEmpty: {
    color: colors.textDim,
    fontSize: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    fontStyle: "italic",
  },
});
