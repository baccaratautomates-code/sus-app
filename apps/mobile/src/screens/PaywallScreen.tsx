import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { PurchasesPackage } from "react-native-purchases";
import { PACKAGE_TYPE } from "react-native-purchases";
import { colors } from "../theme";
import { getOfferings, purchasePackage, restorePurchases } from "../purchases";
import { usePro } from "../context/ProContext";
import type { ScreenProps } from "../navigation";

type Region = "US" | "PH";

// Fallback pricing shown if RevenueCat offerings can't be fetched.
const FALLBACK_PRICING: Record<Region, { monthly: string; annual: string; annualSavings: string }> = {
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
  const { refreshPro } = usePro();
  const [region, setRegion] = useState<Region>("US");
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // RevenueCat packages — null until fetched or if fetch fails.
  const [monthlyPkg, setMonthlyPkg] = useState<PurchasesPackage | null>(null);
  const [annualPkg, setAnnualPkg] = useState<PurchasesPackage | null>(null);

  const fallback = FALLBACK_PRICING[region];

  useEffect(() => {
    (async () => {
      const offerings = await getOfferings();
      const current = offerings?.current;
      if (!current) return;
      setMonthlyPkg(
        current.availablePackages.find(
          (p) => p.packageType === PACKAGE_TYPE.MONTHLY,
        ) ?? null,
      );
      setAnnualPkg(
        current.availablePackages.find(
          (p) => p.packageType === PACKAGE_TYPE.ANNUAL,
        ) ?? null,
      );
    })();
  }, []);

  const onSubscribe = async () => {
    const pkg = selectedPlan === "annual" ? annualPkg : monthlyPkg;

    if (!pkg) {
      // RevenueCat not configured or no offering — inform the user.
      Alert.alert(
        "Not available",
        "In-app purchases are not set up yet. Please contact support.",
      );
      return;
    }

    setLoading(true);
    try {
      const info = await purchasePackage(pkg);
      await refreshPro();
      const isNowPro = "pro" in info.entitlements.active;
      if (isNowPro) {
        Alert.alert("Welcome to Sus Pro 🎉", "Your subscription is now active.", [
          { text: "Let's go", onPress: () => navigation.popToTop() },
        ]);
      }
    } catch (err) {
      const message = (err as Error).message ?? "";
      // "1" is the RevenueCat user-cancelled code — don't show an error for that.
      if (!message.includes("userCancelled")) {
        Alert.alert("Purchase failed", message || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onRestore = async () => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      await refreshPro();
      const isNowPro = "pro" in info.entitlements.active;
      Alert.alert(
        isNowPro ? "Restored ✓" : "Nothing to restore",
        isNowPro
          ? "Your Pro subscription has been restored."
          : "We couldn't find an active subscription for this account.",
      );
      if (isNowPro) navigation.popToTop();
    } catch (err) {
      Alert.alert("Restore failed", (err as Error).message || "Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  // Derive display prices: prefer live RevenueCat data, fall back to hardcoded.
  const annualPrice =
    annualPkg?.product.priceString ?? fallback.annual;
  const monthlyPrice =
    monthlyPkg?.product.priceString ?? fallback.monthly;
  const annualSavings = fallback.annualSavings; // RevenueCat doesn't provide this directly

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
            price={annualPrice}
            note={annualSavings}
            selected={selectedPlan === "annual"}
            onPress={() => setSelectedPlan("annual")}
          />
          <PlanCard
            title="Monthly"
            price={monthlyPrice}
            note="Cancel anytime"
            selected={selectedPlan === "monthly"}
            onPress={() => setSelectedPlan("monthly")}
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

        <Pressable
          onPress={onSubscribe}
          disabled={loading || restoring}
          style={({ pressed }) => [
            styles.cta,
            { opacity: pressed || loading || restoring ? 0.85 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#1A1A1F" />
          ) : (
            <Text style={styles.ctaLabel}>Start Pro</Text>
          )}
        </Pressable>

        <Pressable
          onPress={onRestore}
          disabled={loading || restoring}
          style={styles.restore}
        >
          {restoring ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <Text style={styles.restoreLabel}>Restore purchases</Text>
          )}
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
    minHeight: 52,
    justifyContent: "center",
  },
  ctaLabel: { color: "#1A1A1F", fontSize: 17, fontWeight: "700" },
  restore: {
    alignItems: "center",
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  restoreLabel: { color: colors.textMuted, fontSize: 14 },
  dismiss: { alignItems: "center", paddingVertical: 12 },
  dismissLabel: { color: colors.textDim, fontSize: 14 },
});
