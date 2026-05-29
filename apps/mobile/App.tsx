import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import HomeScreen from "./src/screens/HomeScreen";
import LoadingScreen from "./src/screens/LoadingScreen";
import VerdictScreen from "./src/screens/VerdictScreen";
import PaywallScreen from "./src/screens/PaywallScreen";
import { colors } from "./src/theme";
import type { RootStackParamList } from "./src/navigation";
import { initializePurchases } from "./src/purchases";
import { ProProvider } from "./src/context/ProContext";

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
  useEffect(() => {
    // Initialize RevenueCat once on app start.
    // Replace "test-user" with your real auth user ID when auth is wired.
    initializePurchases("test-user");
  }, []);

  return (
    <SafeAreaProvider>
      <ProProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="dark" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { color: colors.text, fontWeight: "700" },
              contentStyle: { backgroundColor: colors.background },
            }}
          >
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
