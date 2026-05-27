import { sql } from "./db";

// RevenueCat sends one of these event types for every entitlement change.
// Docs: https://www.revenuecat.com/docs/webhooks
//
// We map RC events to our binary is_pro flag. CANCELLATION is intentionally
// NOT in the revoke set — the user retains entitlement until EXPIRATION at
// period end. Treating CANCELLATION as a revoke would prematurely lock paid
// users out before their billing cycle finishes.
const PRO_GRANT_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);

const PRO_REVOKE_EVENTS = new Set([
  "EXPIRATION",
]);

interface RcEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
}

interface RcPayload {
  event?: RcEvent;
  api_version?: string;
}

export interface WebhookResult {
  ok: boolean;
  /** Status code to return to RC. RC retries on 5xx; 4xx and 2xx are terminal. */
  status: number;
  reason?: string;
}

export async function handleRevenueCatEvent(body: unknown): Promise<WebhookResult> {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, reason: "body not an object" };
  }
  const payload = body as RcPayload;
  const event = payload.event;
  if (!event || typeof event !== "object") {
    return { ok: false, status: 400, reason: "missing event" };
  }
  const type = event.type;
  if (typeof type !== "string") {
    return { ok: false, status: 400, reason: "missing event.type" };
  }
  const userId = event.app_user_id ?? event.original_app_user_id;
  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, status: 400, reason: "missing app_user_id" };
  }

  if (PRO_GRANT_EVENTS.has(type)) {
    // The user may not exist in our DB yet (purchase before first scan), so upsert.
    await sql`
      INSERT INTO users (id, is_pro) VALUES (${userId}, true)
      ON CONFLICT (id) DO UPDATE SET is_pro = true
    `;
    console.log(`[webhook] granted Pro to ${userId} (event=${type})`);
    return { ok: true, status: 200 };
  }

  if (PRO_REVOKE_EVENTS.has(type)) {
    await sql`UPDATE users SET is_pro = false WHERE id = ${userId}`;
    console.log(`[webhook] revoked Pro from ${userId} (event=${type})`);
    return { ok: true, status: 200 };
  }

  // Other event types (TEST, CANCELLATION, BILLING_ISSUE, SUBSCRIBER_ALIAS,
  // TRANSFER, etc.) are acknowledged but don't change is_pro. Returning 200
  // tells RC not to retry.
  console.log(`[webhook] ignoring event type=${type} user=${userId}`);
  return { ok: true, status: 200 };
}
