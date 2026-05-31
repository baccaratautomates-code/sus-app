import AsyncStorage from "@react-native-async-storage/async-storage";

// Per-user onboarded key. Each Supabase user gets their own flag so a fresh
// account on a shared device (demo laptop, friend signing up next to you)
// sees the onboarding carousel — the previous version was a single device
// flag, which meant only the very first user on a browser ever saw it.
// Keys are versioned so a future onboarding redesign can re-trigger.
function onboardedKey(userId: string): string {
  return `sus:onboarded:v1:${userId}`;
}

export async function isOnboarded(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(onboardedKey(userId))) === "true";
  } catch {
    return false;
  }
}

export async function markOnboarded(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(onboardedKey(userId), "true");
  } catch {
    // Swallow — onboarding will just show again next launch, which is
    // annoying but not broken.
  }
}
