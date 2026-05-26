import { fetchWithTimeout } from "./_lib";

// Shopee's internal APIs reject "anonymous" fetch calls — they require a session
// cookie that's set when you first hit shopee.ph in a browser. We mimic that by
// doing a GET to the referer page first, harvesting Set-Cookie headers, and
// reusing them for the API call. Result is cached in-process for COOKIE_TTL_MS
// so we don't pay the warmup latency on every scan.

const COOKIE_TTL_MS = 5 * 60 * 1000;          // 5 min — long enough to be useful, short enough to refresh
const WARMUP_TIMEOUT_MS = 8_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface CachedCookies {
  cookieHeader: string;
  csrftoken: string | null;
  expiresAt: number;
}

let cache: CachedCookies | null = null;

/**
 * Returns the headers a Shopee API call should send, including a fresh-enough
 * Cookie header. The first call warms up by GET'ing the referer page; subsequent
 * calls within COOKIE_TTL_MS reuse the cached cookie.
 *
 * If the warmup fails for any reason we return baseline browser-ish headers
 * with no cookie — the API call will probably 403, but we don't crash.
 */
export async function getShopeeHeaders(referer: string): Promise<Record<string, string>> {
  const now = Date.now();
  if (!cache || cache.expiresAt < now) {
    cache = await warmup(referer);
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    accept: "application/json",
    "Accept-Language": "en-PH,en;q=0.9",
    "X-Shopee-Language": "en",
    "X-Requested-With": "XMLHttpRequest",
    Origin: "https://shopee.ph",
    Referer: referer,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };

  if (cache?.cookieHeader) {
    headers.Cookie = cache.cookieHeader;
  }
  if (cache?.csrftoken) {
    // Shopee's API checks this against the cookie's csrftoken value.
    headers["X-CSRFTOKEN"] = cache.csrftoken;
  }

  return headers;
}

async function warmup(referer: string): Promise<CachedCookies> {
  const expiresAt = Date.now() + COOKIE_TTL_MS;
  try {
    const res = await fetchWithTimeout(referer, {
      headers: {
        "User-Agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-PH,en;q=0.9",
      },
      timeoutMs: WARMUP_TIMEOUT_MS,
    });

    // Set-Cookie can be multiple headers; modern fetch APIs expose them via
    // res.headers.getSetCookie() in Bun/Node 18+, or as a comma-joined string
    // via res.headers.get('set-cookie').
    const rawCookies = extractSetCookies(res);
    if (rawCookies.length === 0) {
      console.warn(`[shopee-auth] warmup got no Set-Cookie headers from ${referer}`);
      return { cookieHeader: "", csrftoken: null, expiresAt };
    }

    // Each Set-Cookie value looks like "name=value; Path=/; Domain=...; ...".
    // We want a Cookie request header which is just "name=value; name2=value2".
    const pairs = rawCookies
      .map((c) => c.split(";")[0])
      .filter((p) => p && p.includes("="));
    const cookieHeader = pairs.join("; ");

    const csrf = pairs.find((p) => p.startsWith("csrftoken="));
    const csrftoken = csrf ? csrf.slice("csrftoken=".length) : null;

    console.log(
      `[shopee-auth] warmup ok from ${referer}: ${pairs.length} cookies${csrftoken ? " (csrftoken present)" : ""}`,
    );
    return { cookieHeader, csrftoken, expiresAt };
  } catch (err) {
    console.warn(
      `[shopee-auth] warmup failed for ${referer}: ${(err as Error).message}`,
    );
    return { cookieHeader: "", csrftoken: null, expiresAt };
  }
}

// Bun's Response.headers exposes a `getSetCookie()` method that returns each
// Set-Cookie header as a separate string. Fallback path handles older
// Node-style headers where multiple values are comma-joined.
function extractSetCookies(res: Response): string[] {
  const headers = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const joined = res.headers.get("set-cookie");
  return joined ? joined.split(/,(?=\s*\w+=)/) : [];
}
