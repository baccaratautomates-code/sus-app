import { createNavigationContainerRef } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ScanResponse } from "@sus/shared";

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Home: undefined;
  History: undefined;
  Settings: undefined;
  // Loading runs the scan; either kind triggers the same UI but the network
  // call branches: "url" → POST /scan, "image" → POST /scan/image with base64.
  Loading:
    | { kind: "url"; url: string }
    | { kind: "image"; image: string };
  Verdict: {
    result: ScanResponse;
    // Which tab the user was on when they opened this Verdict. Drives the
    // BottomNav active highlight so the user stays oriented — e.g. tapping a
    // History row keeps the History tab lit instead of falsely activating
    // Scan. Defaults to "scan" (the post-scan flow) when not provided.
    from?: "scan" | "history";
  };
  Paywall: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

// Imperative navigation ref so non-screen code (share-intent handler, deep-link
// listener, etc.) can route into the stack without needing useNavigation.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
