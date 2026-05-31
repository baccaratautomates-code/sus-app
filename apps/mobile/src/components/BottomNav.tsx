import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";
import type { RootStackParamList } from "../navigation";
import { UserAvatar } from "./UserAvatar";

type TabKey = "scan" | "history" | "watch" | "settings";

interface Tab {
  key: TabKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

// Tab order is intentional: Scan (act now) → Watch (live monitoring) →
// History (past record) → Profile (account). Present-tense tabs are grouped
// together; the passive ledger comes after. Watch sits second instead of
// third because it's the Pro upsell — visibility there nudges free users to
// peek at what's behind it.
//
// "settings" still uses Settings as its key internally but renders the user's
// avatar instead of a gear icon — the IG / TikTok / X pattern that signals
// "this tab is you" more clearly than a generic icon.
const TABS: Tab[] = [
  { key: "scan", label: "Scan", icon: "qr-code-scanner" },
  { key: "watch", label: "Watch", icon: "visibility" },
  { key: "history", label: "History", icon: "history" },
  { key: "settings", label: "Profile", icon: "settings" },
];

interface Props {
  active: TabKey;
}

// Static bottom navigation bar. Only "Scan" routes anywhere today (pops back to
// Home); the other tabs surface a "coming soon" alert so the visual model
// matches the Stitch design while History / Watch / Share / Settings screens
// haven't been built yet.
export function BottomNav({ active }: Props) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const onPress = (tab: TabKey) => {
    if (tab === active) return;
    if (tab === "scan") {
      navigation.popToTop();
      return;
    }
    if (tab === "history") {
      navigation.navigate("History");
      return;
    }
    if (tab === "watch") {
      navigation.navigate("Watch");
      return;
    }
    if (tab === "settings") {
      navigation.navigate("Settings");
      return;
    }
    Alert.alert("Coming soon", `${capitalize(tab)} isn't built yet.`);
  };

  return (
    <View style={styles.nav}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const isProfile = tab.key === "settings";
        return (
          <Pressable
            key={tab.key}
            onPress={() => onPress(tab.key)}
            style={styles.tab}
            hitSlop={6}
          >
            <View
              style={[
                styles.iconWrap,
                // Active profile tab gets a ring instead of a pill so the
                // avatar stays the focal element. Other active tabs get the
                // existing pill background.
                isActive && !isProfile && {
                  backgroundColor: colors.primaryContainer,
                },
                isActive && isProfile && {
                  borderWidth: 2,
                  borderColor: colors.primary,
                  width: 32,
                  height: 32,
                },
              ]}
            >
              {isProfile ? (
                <UserAvatar size={26} />
              ) : (
                <MaterialIcons
                  name={tab.icon}
                  size={22}
                  color={isActive ? colors.onPrimary : colors.textMuted}
                />
              )}
            </View>
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.primary : colors.textMuted },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHighest,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: spacing.sm,
  },
  iconWrap: {
    width: 44,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...typography.caption,
    fontWeight: "500", fontFamily: "Inter_500Medium",
  },
});
