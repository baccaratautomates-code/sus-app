import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "./src/screens/HomeScreen";
import LoadingScreen from "./src/screens/LoadingScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import VerdictScreen from "./src/screens/VerdictScreen";
import PaywallScreen from "./src/screens/PaywallScreen";
import { colors } from "./src/theme";
import { navigationRef, type RootStackParamList } from "./src/navigation";
import { initializePurchases } from "./src/purchases";
import { ProProvider } from "./src/context/ProContext";
import { ShareTargetHandler } from "./src/components/ShareTargetHandler";
import { isOnboarded } from "./src/storage";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  dark: false,
  colors: {
    primary: colors.primary,
    background: colors.background,
    card: colors.surfaceContainerLowest,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

export default function App() {
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    // Initialize RevenueCat once on app start.
    // Replace "test-user" with your real auth user ID when auth is wired.
    initializePurchases("test-user");
  }, []);

  useEffect(() => {
    // First-launch detection: skip Onboarding once the user has seen it.
    // The check is async so we hold the navigator on a blank background until
    // we know which route to start at — avoids a flash of the wrong screen.
    isOnboarded().then((seen) => setInitialRoute(seen ? "Home" : "Onboarding"));
  }, []);

  if (initialRoute === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <SafeAreaProvider>
      <ProProvider>
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <StatusBar style="dark" />
          <ShareTargetHandler />
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { color: colors.text, fontWeight: "700" },
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen
              name="Onboarding"
              component={OnboardingScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Loading"
              component={LoadingScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="Verdict"
              component={VerdictScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ headerShown: false, presentation: "modal" }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </ProProvider>
    </SafeAreaProvider>
  );
}
