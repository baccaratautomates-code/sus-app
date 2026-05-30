import { MaterialIcons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { markOnboarded } from "../storage";
import { colors, elevation, radius, spacing, typography } from "../theme";
import type { ScreenProps } from "../navigation";

interface Slide {
  key: string;
  title: string;
  body: string;
  hero: "shield" | "share" | "feature-grid";
}

const SLIDES: Slide[] = [
  {
    key: "problem",
    title: "Don't get scammed online.",
    body: "Sus checks any TikTok Shop, Shopee, or Facebook listing in 30 seconds.",
    hero: "shield",
  },
  {
    key: "how",
    title: "Just hit Share → Sus.",
    body: "From any app. We do the digging.",
    hero: "share",
  },
  {
    key: "tier",
    title: "Start with 3 free scans this month.",
    body: "Upgrade anytime for unlimited protection across all your favorite marketplaces.",
    hero: "feature-grid",
  },
];

const { width: WINDOW_WIDTH } = Dimensions.get("window");

export default function OnboardingScreen({
  navigation,
}: ScreenProps<"Onboarding">) {
  const [pageIndex, setPageIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) setPageIndex(first.index);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const finish = async () => {
    await markOnboarded();
    navigation.replace("Home");
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
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => <Slide slide={item} />}
        getItemLayout={(_, index) => ({
          length: WINDOW_WIDTH,
          offset: WINDOW_WIDTH * index,
          index,
        })}
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

        {isLast ? (
          <Pressable
            onPress={finish}
            style={({ pressed }) => [
              styles.primaryBtn,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.primaryBtnLabel}>Get started</Text>
          </Pressable>
        ) : isMiddle ? (
          <Pressable onPress={goNext} hitSlop={10} style={styles.nextLink}>
            <Text style={styles.nextLinkLabel}>Next</Text>
          </Pressable>
        ) : (
          <View style={styles.nextSpacer} />
        )}
      </View>
    </SafeAreaView>
  );
}

function Slide({ slide }: { slide: Slide }) {
  return (
    <View style={[styles.slide, { width: WINDOW_WIDTH }]}>
      <View style={styles.heroCard}>
        <Hero kind={slide.hero} />
        {/* Decorative purple corner accent matches Stitch mockups. */}
        <View style={styles.heroCorner} />
      </View>
      <Text style={styles.title}>{slide.title}</Text>
      <Text style={styles.body}>{slide.body}</Text>
    </View>
  );
}

function Hero({ kind }: { kind: Slide["hero"] }) {
  if (kind === "feature-grid") return <FeatureGrid />;
  const icon: keyof typeof MaterialIcons.glyphMap =
    kind === "shield" ? "verified-user" : "share";
  return (
    <View style={styles.iconHero}>
      <MaterialIcons name={icon} size={88} color={colors.primary} />
    </View>
  );
}

// Page 3's brand moment: 4 tiles representing speed / verification / safety /
// scan budget. Built inline (not a placeholder) because it's the screen the
// user lands on right before "Get started".
function FeatureGrid() {
  return (
    <View style={styles.grid}>
      <View style={styles.gridRow}>
        <View style={styles.tile}>
          <MaterialIcons name="bolt" size={32} color={colors.primary} />
        </View>
        <View style={styles.tile}>
          <MaterialIcons name="verified" size={32} color={colors.legit} />
        </View>
      </View>
      <View style={styles.gridRow}>
        <View style={styles.tile}>
          <MaterialIcons name="shield" size={32} color={colors.suspicious} />
        </View>
        <View style={[styles.tile, styles.tileFilled]}>
          <Text style={styles.tileNumber}>3</Text>
        </View>
      </View>
    </View>
  );
}

const HERO_SIZE = 220;
const TILE_SIZE = 84;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
    color: colors.primary,
    fontWeight: "900", fontFamily: "Inter_900Black",
    letterSpacing: -1,
  },
  skip: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  heroCard: {
    width: HERO_SIZE,
    height: HERO_SIZE,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    overflow: "hidden",
    ...elevation.card,
  },
  heroCorner: {
    position: "absolute",
    bottom: -20,
    right: -20,
    width: 60,
    height: 60,
    backgroundColor: colors.primary,
    borderTopLeftRadius: radius.md,
    transform: [{ rotate: "0deg" }],
  },
  iconHero: {
    width: HERO_SIZE - 40,
    height: HERO_SIZE - 40,
    borderRadius: radius.full,
    backgroundColor: colors.primaryContainer + "30",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.headlineLgMobile,
    color: colors.text,
    textAlign: "center",
    fontWeight: "800", fontFamily: "Inter_800ExtraBold",
    paddingHorizontal: spacing.sm,
  },
  body: {
    ...typography.bodyMd,
    color: colors.textMuted,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  grid: {
    gap: spacing.sm,
  },
  gridRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    alignItems: "center",
    justifyContent: "center",
    ...elevation.card,
  },
  tileFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tileNumber: {
    color: colors.onPrimary,
    fontSize: 36,
    fontWeight: "900", fontFamily: "Inter_900Black",
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
  dotActive: { width: 28, backgroundColor: colors.primary },
  dotInactive: { width: 8, backgroundColor: colors.outlineVariant },
  nextLink: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  nextLinkLabel: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  nextSpacer: { height: 44 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  primaryBtnLabel: {
    color: colors.onPrimary,
    fontWeight: "700", fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
});
