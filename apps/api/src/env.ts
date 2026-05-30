function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export const env = {
  REDIS_URL: required("REDIS_URL"),
  GROQ_API_KEY: required("GROQ_API_KEY"),
  DATABASE_URL: required("DATABASE_URL"),
  WORKER_QUEUE_NAME: process.env.WORKER_QUEUE_NAME ?? "scraper-queue",
  // RevenueCat webhook secret — when unset, /webhooks/revenuecat returns 503.
  // Set this in production once you wire the RC dashboard webhook.
  REVENUECAT_WEBHOOK_SECRET: process.env.REVENUECAT_WEBHOOK_SECRET ?? "",
  // OCR.space API key for /scan/image. Falls back to the public "helloworld"
  // demo key — fine for local testing, hits a 500/day quota in production.
  // Get a free key (25K/month) at https://ocr.space/ocrapi.
  OCR_SPACE_API_KEY: process.env.OCR_SPACE_API_KEY ?? "helloworld",
  // Comma-separated Supabase user IDs that bypass the free-tier quota gate.
  // Use this for demo/test accounts that need unlimited scans without flipping
  // is_pro = true in the DB (which would collide with RevenueCat once live).
  // Format: BYPASS_USER_IDS=uuid-1,uuid-2
  BYPASS_USER_IDS: process.env.BYPASS_USER_IDS ?? "",
};
