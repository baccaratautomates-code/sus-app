// Lazada PH ships its product data inside the HTML page as a JSON blob,
// but anti-bot still 403s "anonymous" requests without a real-looking
// User-Agent and Accept-Language. Lazada doesn't strictly require a warmup
// cookie like Shopee does — but we send one set of consistent headers so the
// request looks like Chrome on Windows from a PH visitor.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function getLazadaHeaders(referer: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-PH,en;q=0.9,tl;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: referer,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
  };
}
