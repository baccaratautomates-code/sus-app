import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme";
import { mockState } from "../store";
import type { ScreenProps } from "../navigation";

type Region = "US" | "PH";

const PRICING: Record<Region, { monthly: string; annual: string; annualSavings: string }> = {
  US: { monthly: "$9.99/mo", annual: "$79.99/yr", annualSavings: "Save 34%" },
  PH: { monthly: "₱299/mo", annual: "₱2,490/yr", annualSavings: "Save ~30%" },
};

const FEATURES = [
  "Unlimited scans",
  "Unlimited history",
  "Watch alerts when red flags emerge",
  "Share branded verdict cards",
  "Priority scan speed",
];

export default function PaywallScreen({ navigation }: ScreenProps<"Paywall">) {
  const [region, setRegion] = useState<Region>("US");
  const [plan, setPlan] = useState<"monthly" | "annual">("annual");
  const price = PRICING[region];

  const onSubscribe = () => {
    mockState.isPro = true;
    Alert.alert("Welcome to Sus Pro", "Your subscription is active (mock).", [
      { text: "OK", onPress: () => navigation.popToTop() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.headline}>You've used your 3 free scans this month</Text>
        <Text style={styles.subhead}>Unlock unlimited verdicts and Watch alerts.</Text>

        <View style={styles.regionRow}>
          {(["US", "PH"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRegion(r)}
              style={[styles.regionPill, region === r && styles.regionPillActive]}
            >
              <Text
                style={[
                  styles.regionLabel,
                  region === r && styles.regionLabelActive,
                ]}
              >
                {r}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.plans}>
          <PlanCard
            title="Annual"
            price={price.annual}
            note={price.annualSavings}
            selected={plan === "annual"}
            onPress={() => setPlan("annual")}
          />
          <PlanCard
            title="Monthly"
            price={price.monthly}
            note="Cancel anytime"
            selected={plan === "monthly"}
            onPress={() => setPlan("monthly")}
          />
        </View>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={onSubscribe} style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.85 : 1 }]}>
          <Text style={styles.ctaLabel}>Start Pro</Text>
        </Pressable>

        <Pressable onPress={() => navigation.goBack()} style={styles.dismiss}>
          <Text style={styles.dismissLabel}>Maybe later</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanCard({
  title,
  price,
  note,
  selected,
  onPress,
}: {
  title: string;
  price: string;
  note: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.planCard, selected && styles.planCardSelected]}
    >
      <Text style={styles.planTitle}>{title}</Text>
      <Text style={styles.planPrice}>{price}</Text>
      <Text style={styles.planNote}>{note}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  headline: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
    marginBottom: 8,
    marginTop: 12,
  },
  subhead: { color: colors.textMuted, fontSize: 15, marginBottom: 28 },
  regionRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  regionPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  regionPillActive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.accent,
  },
  regionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  regionLabelActive: { color: colors.text },
  plans: { flexDirection: "row", gap: 12, marginBottom: 28 },
  planCard: {
    flex: 1,
    padding: 18,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  planCardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  planTitle: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  planPrice: { color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 4 },
  planNote: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  features: { marginBottom: 28, gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  featureCheck: { color: colors.legit, fontSize: 16, fontWeight: "700" },
  featureText: { color: colors.text, fontSize: 15, flex: 1 },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  ctaLabel: { color: "#1A1A1F", fontSize: 17, fontWeight: "700" },
  dismiss: { alignItems: "center", paddingVertical: 12 },
  dismissLabel: { color: colors.textMuted, fontSize: 14 },
});
