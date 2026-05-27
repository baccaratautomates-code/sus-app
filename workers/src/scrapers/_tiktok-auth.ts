// TikTok is the most hostile of the three marketplaces to scrape. Their data
// is split across:
//   • SSR-embedded JSON in the page HTML (changes shape often)
//   • SIGI_STATE / __UNIVERSAL_DATA_FOR_REHYDRATION__ blobs (also moves around)
//   • Signed/tokenized API endpoints we can't realistically hit from a server
//
// We send the most browser-realistic headers we can and accept that some
// fetches will 403. Even partial data (follower count from HTML) is useful
// signal vs nothing.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function getTiktokHeaders(referer: string): Record<string, string> {
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
