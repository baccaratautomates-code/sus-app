import IORedis from "ioredis";
import type { ScanResponse } from "@sus/shared";
import { env } from "./env";

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

const redis = new IORedis(env.REDIS_URL);

function key(target: string): string {
  return `sus:verdict:${target}`;
}

export async function getCachedVerdict(target: string): Promise<ScanResponse | null> {
  const raw = await redis.get(key(target));
  return raw ? (JSON.parse(raw) as ScanResponse) : null;
}

export async function setCachedVerdict(target: string, verdict: ScanResponse): Promise<void> {
  await redis.set(key(target), JSON.stringify(verdict), "EX", SEVEN_DAYS_SECONDS);
}
