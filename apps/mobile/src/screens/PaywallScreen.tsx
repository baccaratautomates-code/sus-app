import { MaterialIcons } from "@expo/vector-icons";
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
import {
  colors,
  elevation,
  radius,
  spacing,
  typography,
} from "../theme";
import { getOfferings, purchasePackage, restorePurchases } from "../purchases";
import { usePro } from "../context/ProContext";
import type { ScreenProps } from "../navigation";

type Region = "US" | "PH";

// Fallback pricing shown if RevenueCat offerings can't be fetched.
// Matches PRD §4.2 — keep these in sync with App Store Connect / Play Console.
const FALLBACK_PRICING: Record<
  Region,
  { monthly: string; annual: string; annualSavings: string }
> = {
  US: { monthly: "$9.99/mo", annual: "$79.99/yr", annualSavings: "Save 34%" },
  PH: { monthly: "₱299/mo", annual: "₱2,490/yr", annualSavings: "Save ~30%" },
};

// PRD §4.2 Pro tier features.
const FEATURES = [
  { title: "Unlimited scans", desc: "No monthly cap — check as much as you want." },
  { title: "Unlimited history", desc: "Keep every scan permanently in your log." },
  { title: "Watch alerts", desc: "We re-check saved listings + alert you on new red flags." },
  { title: "Branded share cards", desc: "Export verdicts as image cards for social." },
  { title: "Priority scan speed", desc: "Dedicated queue for faster verdicts." },
];

export default function PaywallScreen({ navigation }: ScreenProps<"Paywall">) {
  const { refreshPro } = usePro();
  const [region, setRegion] = useState<Region>("US");
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "annual">("annual");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

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
      if (!message.includes("userCancelled")) {
        Alert.alert(
          "Purchase failed",
          message || "Something went wrong. Please try again.",
        );
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

  const annualPrice = annualPkg?.product.priceString ?? fallback.annual;
  const monthlyPrice = monthlyPkg?.product.priceString ?? fallback.monthly;
  const annualSavings = fallback.annualSavings;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header: drag handle + close button */}
        <View style={styles.handleRow}>
          <View style={styles.handle} />
        </View>
        <View style={styles.closeRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.closeBtn}
            hitSlop={8}
          >
            <MaterialIcons name="close" size={24} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Headline */}
        <Text style={styles.headline}>
          You've used your 3 free scans this month.
        </Text>
        <Text style={styles.subhead}>
          Unlock unlimited verdicts and Watch alerts.
        </Text>

        {/* Region toggle */}
        <View style={styles.regionRow}>
          {(["US", "PH"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRegion(r)}
              style={[
                styles.regionPill,
                region === r && styles.regionPillActive,
              ]}
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

        {/* Plan cards */}
        <View style={styles.planList}>
          <PlanCard
            title="Annual"
            price={annualPrice}
            note={annualSavings}
            bestValue
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

        {/* Features */}
        <View style={styles.featuresList}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={styles.featureCheck}>
                <MaterialIcons
                  name="check"
                  size={16}
                  color={colors.onLegitContainer}
                />
              </View>
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Pressable
          onPress={onSubscribe}
          disabled={loading || restoring}
          style={({ pressed }) => [
            styles.cta,
            { opacity: pressed || loading || restoring ? 0.85 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.ctaLabel}>Unlock Sus Pro</Text>
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

        <View style={styles.legalRow}>
          <Text style={styles.legalLink}>Privacy Policy</Text>
          <Text style={styles.legalDot}>·</Text>
          <Text style={styles.legalLink}>Terms of Use</Text>
          <Text style={styles.legalDot}>·</Text>
          <Pressable onPress={onRestore} hitSlop={8}>
            <Text style={styles.legalLink}>Restore</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanCard({
  title,
  price,
  note,
  selected,
  bestValue,
  onPress,
}: {
  title: string;
  price: string;
  note: string;
  selected: boolean;
  bestValue?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.planCard, selected && styles.planCardSelected]}
    >
      {bestValue && (
        <View style={styles.bestValuePill}>
          <Text style={styles.bestValueLabel}>BEST VALUE</Text>
        </View>
      )}
      <View style={styles.planLeft}>
        <Text style={styles.planTitle}>{title}</Text>
        <Text style={styles.planPrice}>{price}</Text>
        <Text style={styles.planNote}>{note}</Text>
      </View>
      <View
        style={[styles.planRadio, selected && styles.planRadioSelected]}
      >
        {selected && <View style={styles.planRadioDot} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  handleRow: { alignItems: "center", paddingTop: spacing.sm },
  handle: {
    width: 48,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHighest,
  },
  closeRow: { alignItems: "flex-end", marginTop: spacing.sm },
  closeBtn: {
    padding: spacing.xs,
    borderRadius: radius.full,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.text,
    marginTop: spacing.md,
  },
  subhead: {
    ...typography.bodyMd,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  regionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  regionPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  regionPillActive: {
    backgroundColor: colors.primaryFixed,
    borderColor: colors.primary,
  },
  regionLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  regionLabelActive: { color: colors.primary },
  planList: { gap: spacing.sm, marginBottom: spacing.lg },
  planCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    padding: spacing.md,
    backgroundColor: colors.surfaceContainerLowest,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryFixed,
  },
  bestValuePill: {
    position: "absolute",
    top: -10,
    left: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  bestValueLabel: {
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.5,
  },
  planLeft: { flex: 1 },
  planTitle: {
    ...typography.labelMd,
    color: colors.text,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  planPrice: {
    ...typography.headlineMdMobile,
    color: colors.primary,
    marginTop: 2,
  },
  planNote: {
    ...typography.caption,
    color: colors.onLegitContainer,
    fontWeight: "600", fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  planRadio: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: "center",
    justifyContent: "center",
  },
  planRadioSelected: { borderColor: colors.primary },
  planRadioDot: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  featuresList: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  featureCheck: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.legitContainer,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  featureBody: { flex: 1, gap: 2 },
  featureTitle: {
    ...typography.labelMd,
    color: colors.text,
  },
  featureDesc: {
    ...typography.caption,
    color: colors.textMuted,
  },
  cta: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    ...elevation.card,
  },
  ctaLabel: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
  },
  restore: {
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  restoreLabel: {
    ...typography.labelMd,
    color: colors.textMuted,
  },
  dismiss: { alignItems: "center", paddingVertical: spacing.sm },
  dismissLabel: {
    ...typography.labelMd,
    color: colors.textDim,
  },
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
  },
  legalLink: {
    fontSize: 11,
    color: colors.textMuted,
    textDecorationLine: "underline",
  },
  legalDot: { color: colors.textDim, fontSize: 11 },
});
