import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import { Platform } from "react-native";

// Set these in apps/mobile/.env
// EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID — from RevenueCat dashboard → Android app
// EXPO_PUBLIC_REVENUECAT_API_KEY_IOS     — from RevenueCat dashboard → iOS app
const RC_API_KEY =
  Platform.OS === "ios"
    ? (process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS ?? "")
    : (process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID ?? "");

// The entitlement ID you defined in the RevenueCat dashboard.
// Must match exactly — default is "pro" unless you renamed it.
export const PRO_ENTITLEMENT_ID = "pro";

// RevenueCat Offering identifier to load (use "default" unless you created a custom one).
const OFFERING_ID = "default";

/**
 * Call once on app start (in App.tsx), before any purchase or entitlement check.
 * Pass the authenticated user's ID so RevenueCat can sync purchase history across devices.
 */
export function initializePurchases(appUserID?: string): void {
  if (!RC_API_KEY) {
    console.warn(
      "[purchases] RevenueCat API key not set. " +
        "Set EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID / _IOS in apps/mobile/.env",
    );
    return;
  }
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: RC_API_KEY, appUserID });
  console.log("[purchases] RevenueCat configured", { appUserID });
}

/**
 * Returns true if the current user has an active Pro entitlement.
 * Always resolves — returns false on any error.
 */
export async function getIsPro(): Promise<boolean> {
  if (!RC_API_KEY) return false;
  try {
    const info: CustomerInfo = await Purchases.getCustomerInfo();
    return PRO_ENTITLEMENT_ID in info.entitlements.active;
  } catch (err) {
    console.warn("[purchases] getIsPro failed:", (err as Error).message);
    return false;
  }
}

/**
 * Fetches the default offering from RevenueCat.
 * Returns null if not configured or on network error — callers should fall back
 * to the hardcoded PRICING display in PaywallScreen.
 */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!RC_API_KEY) return null;
  try {
    return await Purchases.getOfferings();
  } catch (err) {
    console.warn("[purchases] getOfferings failed:", (err as Error).message);
    return null;
  }
}

/**
 * Purchase a RevenueCat package. Throws on cancellation or error so the
 * caller can handle accordingly. RevenueCat dedupes concurrent purchase calls.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/**
 * Restore previously purchased subscriptions (required by App Store / Play Store).
 * Returns the updated CustomerInfo — check entitlements after.
 */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/**
 * Log out the current RevenueCat user (call on app sign-out).
 */
export async function logOutPurchases(): Promise<void> {
  if (!RC_API_KEY) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.warn("[purchases] logOut failed:", (err as Error).message);
  }
}
