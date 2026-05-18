import type { ScanResponse, Verdict } from "@sus/shared";

export interface RecentScan {
  id: string;
  product_name: string;
  verdict: Verdict;
  scanned_at: string;
}

// Mock in-memory state for the prototype. Replace with persistent storage + API later.
export const mockState = {
  scansLeft: 2,
  isPro: false,
  recentScans: [
    {
      id: "r1",
      product_name: "Acme Wireless Earbuds Pro",
      verdict: "Looks Legit" as Verdict,
      scanned_at: "2026-05-18T14:22:00Z",
    },
    {
      id: "r2",
      product_name: "$12 'iPhone 15 Pro' from @giftshop_ph",
      verdict: "High Risk" as Verdict,
      scanned_at: "2026-05-17T09:11:00Z",
    },
    {
      id: "r3",
      product_name: "TikTok Shop weight-loss tea",
      verdict: "Suspicious" as Verdict,
      scanned_at: "2026-05-15T19:43:00Z",
    },
  ] as RecentScan[],
};

export function mockVerdictFor(url: string): ScanResponse {
  return {
    trust_score: 34,
    verdict: "Suspicious",
    summary:
      "This seller has 3-month-old reviews concentrated in a 2-week window and is flagged on Scamadviser. Pricing is 60% below market for the listed brand, which is a common counterfeit signal.",
    red_flags: [
      "Domain registered 47 days ago via privacy-protected WHOIS",
      "Reviews show velocity spike pattern (Fakespot-style: F)",
      "Listed price 60% below brand MSRP — counterfeit signal",
    ],
    green_flags: [],
    confidence: "Medium",
    sources: [
      {
        url: "https://www.scamadviser.com/check-website/example.com",
        title: "Scamadviser report",
        signal_type: "domain",
      },
      {
        url: "https://www.reddit.com/r/scams/comments/example",
        title: "r/scams — discussion thread",
        signal_type: "seller_reputation",
      },
      {
        url: "https://www.amazon.com/dp/B0EXAMPLE",
        title: "Reference price on Amazon",
        signal_type: "price_sanity",
      },
    ],
    scanned_at: new Date().toISOString(),
    input: { kind: "url", url, user_id: "mock-user" },
  };
}
