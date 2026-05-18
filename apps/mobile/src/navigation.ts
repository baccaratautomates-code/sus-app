import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ScanResponse } from "@sus/shared";

export type RootStackParamList = {
  Home: undefined;
  Loading: { url: string };
  Verdict: { result: ScanResponse };
  Paywall: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
