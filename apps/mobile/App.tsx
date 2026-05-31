import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AuthScreen from "./src/screens/AuthScreen";
import FarewellScreen from "./src/screens/FarewellScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import HomeScreen from "./src/screens/HomeScreen";
import LoadingScreen from "./src/screens/LoadingScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import VerdictScreen from "./src/screens/VerdictScreen";
import WatchScreen from "./src/screens/WatchScreen";
import PaywallScreen from "./src/screens/PaywallScreen";
import { colors } from "./src/theme";
import { navigationRef, type RootStackParamList } from "./src/navigation";
import { initializePurchases, logOutPurchases } from "./src/purchases";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { OnboardedProvider, useOnboarded } from "./src/context/OnboardedContext";
import { ProProvider } from "./src/context/ProContext";
import { ShareTargetHandler } from "./src/components/ShareTargetHandler";

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
  // Load Inter at app boot. Until fonts load, we hold on a blank screen so
  // typography doesn't flash from system-font to Inter once styles resolve.
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <OnboardedProvider>
          <ProProvider>
            <Root />
          </ProProvider>
        </OnboardedProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// Auth-aware navigator. Renders one of three screen stacks depending on session
// + onboarding state, so React Navigation cleanly remounts when the user signs
// in / out instead of us having to imperatively navigate.
function Root() {
  const { session, loading: authLoading, user } = useAuth();
  const { onboarded } = useOnboarded();

  // Re-sync RC's appUserID whenever the auth user changes. On sign-out we call
  // logOut so RC treats the next anon as a fresh user (no accidental
  // entitlement leakage between accounts).
  useEffect(() => {
    if (user?.id) {
      initializePurchases(user.id);
    } else {
      logOutPurchases();
    }
  }, [user?.id]);

  // Block render until auth resolves. Onboarded loads asynchronously after
  // sign-in (it's now per-user), so we only wait on it when there IS a session.
  if (authLoading || (session && onboarded === null)) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <StatusBar style="dark" />
      <ShareTargetHandler />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text, fontWeight: "700" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!session ? (
          <Stack.Screen
            name="Auth"
            component={AuthScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
        ) : !onboarded ? (
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="History"
              component={HistoryScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Watch"
              component={WatchScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Farewell"
              component={FarewellScreen}
              options={{ headerShown: false, gestureEnabled: false }}
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
