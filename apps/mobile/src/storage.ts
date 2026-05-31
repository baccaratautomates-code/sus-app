import AsyncStorage from "@react-native-async-storage/async-storage";

// Device-wide onboarded flag. Onboarding runs BEFORE sign-in so the carousel
// is the user's first impression of the app — it has to be keyed by device,
// not by user, because we don't know who the user is yet at that point.
// Versioned so a future onboarding redesign can re-trigger the carousel.
const ONBOARDED_KEY = "sus:onboarded:v1";

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    // Swallow — onboarding will just show again next launch, which is
    // annoying but not broken.
  }
}
