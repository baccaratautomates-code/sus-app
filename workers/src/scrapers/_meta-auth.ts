// Shared headers helper for Meta-owned properties (Facebook + Instagram).
// Both sites aggressively wall content behind login. From an anonymous request
// we can usually still get:
//   • Open Graph meta tags (page name, description, image)
//   • Some structured-data JSON blobs (best-effort, layout changes often)
// We send browser-like headers and accept that some fetches return a login wall
// page instead of real content.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function getMetaHeaders(referer: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: referer,
    "Sec-Ch-Ua":
      '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
  };
}
