import { MaterialIcons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOnboarded } from "../context/OnboardedContext";
import { colors, radius, spacing, typography } from "../theme";
import type { ScreenProps } from "../navigation";

interface Slide {
  key: string;
  title: string;
  body: string;
  hero: "shield" | "phone-share" | "premium-trial";
  // Layout direction. Page 1 and 3 lead with the illustration; page 2 leads
  // with the headline (matches the Stitch designs exactly).
  layout: "hero-top" | "text-top";
}

const SLIDES: Slide[] = [
  {
    key: "problem",
    title: "Don't get scammed online.",
    body: "Sus checks any TikTok Shop, Shopee, or Facebook listing in 30 seconds.",
    hero: "shield",
    layout: "hero-top",
  },
  {
    key: "how",
    title: "Just hit Share → Sus.",
    body: "From any app. We do the digging.",
    hero: "phone-share",
    layout: "text-top",
  },
  {
    key: "tier",
    title: "Start with 3 free scans this month.",
    body: "No credit card required. Trust your gut, but verify with Sus.",
    hero: "premium-trial",
    layout: "hero-top",
  },
];

export default function OnboardingScreen({}: ScreenProps<"Onboarding">) {
  const [pageIndex, setPageIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const { markComplete } = useOnboarded();
  // Track the live window width so slides re-flow on browser resize. Using
  // Dimensions.get() at module load freezes the slide size to whatever the
  // viewport was when JS first booted — fine on native, broken on web.
  const { width: windowWidth } = useWindowDimensions();

  // Compute the active page from the scroll offset on every frame. Uses
  // onScroll (not onViewableItemsChanged) because react-native-web doesn't
  // fire viewability events for horizontal pagingEnabled lists, so dots
  // wouldn't sync on the Vercel demo.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (windowWidth === 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, idx));
    if (clamped !== pageIndex) setPageIndex(clamped);
  };

  // Mark onboarding complete and let Root re-render with the next stack.
  // Onboarding runs before sign-in, so the user lands on Auth next (or
  // straight into Home if they signed in on a previous device install).
  const finish = async () => {
    await markComplete();
  };

  const goNext = () => {
    if (pageIndex < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: pageIndex + 1, animated: true });
    } else {
      finish();
    }
  };

  const isLast = pageIndex === SLIDES.length - 1;
  const isMiddle = pageIndex === 1;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <MaterialIcons name="verified-user" size={26} color={colors.primary} />
          <Text style={styles.brandName}>Sus</Text>
        </View>
        <Pressable onPress={finish} hitSlop={10}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => <Slide slide={item} width={windowWidth} />}
        getItemLayout={(_, index) => ({
          length: windowWidth,
          offset: windowWidth * index,
          index,
        })}
        // Force re-layout when the viewport changes (browser resize).
        extraData={windowWidth}
      />

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {SLIDES.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.dot,
                i === pageIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <Pressable
          onPress={isLast ? finish : goNext}
          style={({ pressed }) => [
            styles.primaryBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.primaryBtnLabel}>
            {pageIndex === 0 ? "Get Started" : isMiddle ? "Next" : "Get started"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Slide({ slide, width }: { slide: Slide; width: number }) {
  // Page 1 leads with the problem statement — make the title noticeably bigger
  // so it lands harder than the on-flow secondary pages.
  const isFirst = slide.key === "problem";
  const textBlock = (
    <View style={styles.textBlock}>
      <Text style={[styles.title, isFirst && styles.titleLarge]}>
        {slide.title}
      </Text>
      <Text style={styles.body}>{slide.body}</Text>
    </View>
  );
  const heroBlock = <Hero kind={slide.hero} />;

  return (
    <View style={[styles.slide, { width }]}>
      {slide.layout === "text-top" ? (
        <>
          {textBlock}
          {heroBlock}
        </>
      ) : (
        <>
          {heroBlock}
          {textBlock}
        </>
      )}
    </View>
  );
}

function Hero({ kind }: { kind: Slide["hero"] }) {
  if (kind === "shield") return <ShieldHero />;
  if (kind === "phone-share") return <PhoneShareHero />;
  return <PremiumTrialHero />;
}

// Page 1: a glowing glassy shield with status pills. Three concentric
// circles create the soft radial halo behind the shield icon.
function ShieldHero() {
  return (
    <View style={styles.shieldHero}>
      <View style={styles.shieldGlowOuter} />
      <View style={styles.shieldGlowInner} />
      <View style={styles.shieldCore}>
        <MaterialIcons name="verified-user" size={84} color={colors.onPrimary} />
      </View>
      <View style={[styles.statusPill, styles.safePill]}>
        <MaterialIcons name="check-circle" size={12} color={colors.legit} />
        <Text style={styles.safeLabel}>Safe</Text>
      </View>
      <View style={[styles.statusPill, styles.alertPill]}>
        <MaterialIcons name="warning" size={12} color={colors.highRisk} />
        <Text style={styles.alertLabel}>Scam Alert</Text>
      </View>
    </View>
  );
}

// Page 2: a phone mockup with skeleton content and a share sheet at the
// bottom, highlighting the Sus tile to show where the share action lands.
function PhoneShareHero() {
  return (
    <View style={styles.phoneFrame}>
      <View style={styles.phoneScreen}>
        <View style={styles.skelLineSmall} />
        <View style={styles.skelImageBlock} />
        <View style={styles.skelLineWide} />
        <View style={styles.skelLineMid} />
        <View style={styles.shareSheet}>
          <View style={styles.shareRow}>
            <ShareTile icon="mail" label="Mail" />
            <ShareTile icon="sms" label="Messages" />
            <ShareTile icon="verified-user" label="Sus" active />
          </View>
          <View style={styles.shareBottomRow}>
            <MaterialIcons name="add" size={14} color={colors.outlineVariant} />
            <View style={styles.skelLineThin} />
          </View>
          <View style={styles.shareBottomRow}>
            <MaterialIcons name="share" size={14} color={colors.outlineVariant} />
            <View style={styles.skelLineThin} />
          </View>
        </View>
      </View>
    </View>
  );
}

function ShareTile({
  icon,
  label,
  active,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active?: boolean;
}) {
  return (
    <View style={styles.shareTile}>
      <View style={[styles.shareTileIcon, active && styles.shareTileIconActive]}>
        <MaterialIcons
          name={icon}
          size={20}
          color={active ? colors.onPrimary : colors.text}
        />
      </View>
      <Text style={[styles.shareTileLabel, active && styles.shareTileLabelActive]}>
        {label}
      </Text>
    </View>
  );
}

// Page 3: the premium trial moment — a glassy card with a progress bar
// showing free-tier usage, plus a small accent tile below.
function PremiumTrialHero() {
  return (
    <View style={styles.premiumWrap}>
      <View style={styles.premiumCard}>
        <View style={styles.premiumCardHeader}>
          <View style={styles.premiumCardChip} />
          <MaterialIcons
            name="circle"
            size={20}
            color="rgba(255, 255, 255, 0.4)"
          />
        </View>
        <Text style={styles.premiumLabel}>PREMIUM TRIAL</Text>
        <Text style={styles.premiumValue}>3 Free Scans</Text>
        <View style={styles.premiumProgressTrack}>
          <View style={styles.premiumProgressFill} />
        </View>
      </View>
      <View style={styles.bagTile}>
        <MaterialIcons
          name="card-giftcard"
          size={26}
          color={colors.primary}
        />
      </View>
    </View>
  );
}

const HERO_SIZE = 280;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primaryContainer },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brandName: {
    ...typography.headlineMdMobile,
    color: colors.onPrimary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  skip: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  textBlock: {
    alignItems: "center",
    gap: spacing.xs,
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.onPrimary,
    textAlign: "center",
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
    paddingHorizontal: spacing.sm,
  },
  titleLarge: {
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -1,
    fontWeight: "900", fontFamily: "Inter_900Black",
  },
  body: {
    ...typography.bodyMd,
    color: "rgba(255, 255, 255, 0.85)",
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },

  // --- Shield hero (page 1)
  shieldHero: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldGlowOuter: {
    position: "absolute",
    width: HERO_SIZE,
    height: HERO_SIZE,
    borderRadius: HERO_SIZE / 2,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  shieldGlowInner: {
    position: "absolute",
    width: HERO_SIZE - 60,
    height: HERO_SIZE - 60,
    borderRadius: (HERO_SIZE - 60) / 2,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  shieldCore: {
    width: HERO_SIZE - 130,
    height: HERO_SIZE - 130,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  statusPill: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  safePill: {
    top: 32,
    right: 22,
    backgroundColor: colors.legitContainer,
  },
  safeLabel: {
    fontSize: 11,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    color: colors.legit,
  },
  alertPill: {
    bottom: 40,
    left: 18,
    backgroundColor: colors.highRiskContainer,
  },
  alertLabel: {
    fontSize: 11,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    color: colors.highRisk,
  },

  // --- Phone share hero (page 2)
  phoneFrame: {
    width: 200,
    height: 380,
    borderRadius: 28,
    // Light lavender frame matches the Stitch mockup (a tint of primary).
    backgroundColor: "#C1C1FF",
    padding: 4,
    alignItems: "center",
  },
  phoneScreen: {
    flex: 1,
    width: "100%",
    borderRadius: 24,
    backgroundColor: colors.onPrimary,
    padding: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
    gap: 6,
  },
  skelLineSmall: {
    position: "absolute",
    top: 14,
    left: 14,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceContainer,
    width: "50%",
  },
  skelImageBlock: {
    position: "absolute",
    top: 32,
    left: 14,
    right: 14,
    height: 80,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainer,
  },
  skelLineWide: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surfaceContainer,
    width: "100%",
    marginBottom: 4,
  },
  skelLineMid: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surfaceContainer,
    width: "75%",
    marginBottom: 8,
  },
  skelLineThin: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceContainerHighest,
    flex: 1,
  },
  shareSheet: {
    // Frosted-glass overlay that sits at the bottom of the phone screen.
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderRadius: 18,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
  },
  shareRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  shareTile: {
    alignItems: "center",
    gap: 2,
    flex: 1,
  },
  shareTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainer,
    alignItems: "center",
    justifyContent: "center",
  },
  shareTileIconActive: {
    backgroundColor: colors.primaryContainer,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    transform: [{ scale: 1.08 }],
  },
  shareTileLabel: {
    fontSize: 8,
    fontWeight: "500", fontFamily: "Inter_500Medium",
    color: colors.textMuted,
  },
  shareTileLabelActive: {
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  shareBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },

  // --- Premium trial hero (page 3)
  premiumWrap: {
    width: HERO_SIZE,
    alignItems: "center",
    position: "relative",
  },
  premiumCard: {
    width: HERO_SIZE - 40,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
    padding: spacing.md,
    gap: 6,
  },
  premiumCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  premiumCardChip: {
    width: 30,
    height: 22,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  premiumLabel: {
    fontSize: 11,
    fontWeight: "600", fontFamily: "Inter_600SemiBold",
    color: "rgba(255, 255, 255, 0.75)",
    letterSpacing: 1,
  },
  premiumValue: {
    fontSize: 22,
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
    color: colors.onPrimary,
    marginBottom: spacing.sm,
  },
  premiumProgressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    overflow: "hidden",
  },
  premiumProgressFill: {
    height: 6,
    width: "100%",
    backgroundColor: colors.legit,
    borderRadius: 3,
  },
  bagTile: {
    position: "absolute",
    bottom: -spacing.md,
    right: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.onPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
    alignItems: "center",
  },
  dotsRow: { flexDirection: "row", gap: spacing.xs, alignItems: "center" },
  dot: { height: 8, borderRadius: 4 },
  dotActive: { width: 28, backgroundColor: colors.onPrimary },
  dotInactive: { width: 8, backgroundColor: "rgba(255, 255, 255, 0.35)" },
  primaryBtn: {
    backgroundColor: colors.onPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  primaryBtnLabel: {
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
});
