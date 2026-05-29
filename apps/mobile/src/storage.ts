import AsyncStorage from "@react-native-async-storage/async-storage";

// Persisted flags. Keys are versioned so a future redesign of the onboarding
// can re-trigger it without users having to clear storage manually.
const KEYS = {
  onboarded: "sus:onboarded:v1",
} as const;

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEYS.onboarded)) === "true";
  } catch {
    return false;
  }
}

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.onboarded, "true");
  } catch {
    // Swallow — onboarding will just show again next launch, which is
    // annoying but not broken.
  }
}
