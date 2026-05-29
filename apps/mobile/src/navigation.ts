import { createNavigationContainerRef } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ScanResponse } from "@sus/shared";

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Loading: { url: string };
  Verdict: { result: ScanResponse };
  Paywall: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

// Imperative navigation ref so non-screen code (share-intent handler, deep-link
// listener, etc.) can route into the stack without needing useNavigation.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
