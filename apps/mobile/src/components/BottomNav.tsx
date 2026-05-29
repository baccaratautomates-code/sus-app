import { MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";
import type { RootStackParamList } from "../navigation";

type TabKey = "scan" | "history" | "watch" | "share" | "settings";

interface Tab {
  key: TabKey;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

const TABS: Tab[] = [
  { key: "scan", label: "Scan", icon: "qr-code-scanner" },
  { key: "history", label: "History", icon: "history" },
  { key: "watch", label: "Watch", icon: "visibility" },
  { key: "share", label: "Share", icon: "share" },
  { key: "settings", label: "Settings", icon: "settings" },
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
    Alert.alert("Coming soon", `${capitalize(tab)} isn't built yet.`);
  };

  return (
    <View style={styles.nav}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
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
                isActive && { backgroundColor: colors.primaryContainer },
              ]}
            >
              <MaterialIcons
                name={tab.icon}
                size={22}
                color={isActive ? colors.onPrimary : colors.textMuted}
              />
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
    fontWeight: "500",
  },
});
