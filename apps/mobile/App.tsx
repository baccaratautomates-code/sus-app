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
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
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
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerTitleStyle: { color: colors.text },
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
              options={{ title: "Verdict" }}
            />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ presentation: "modal", title: "Go Pro" }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </ProProvider>
    </SafeAreaProvider>
  );
}
