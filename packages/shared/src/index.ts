// Single source of truth for types shared across apps/* and workers/*.
// See docs/sus-prd.md §3 for the Verdict Engine contract.

export type Verdict =
  | "Looks Legit"
  | "Suspicious"
  | "High Risk"
  | "Not Enough Info";

export type Confidence = "High" | "Medium" | "Low";

export type SignalType =
  | "seller_reputation"
  | "ph_specific"
  | "domain"
  | "price_sanity"
  | "review_authenticity"
  | "internal_scam_db"
  | "news";

export interface Source {
  url: string;
  title: string;
  signal_type: SignalType;
}

export type ScanInputKind = "url" | "image";

export interface ScanRequest {
  kind: ScanInputKind;
  url?: string;
  image_id?: string;
  user_id: string;
}

export interface ScanResponse {
  trust_score: number; // 0-100
  verdict: Verdict;
  summary: string;
  red_flags: string[];
  green_flags: string[];
  confidence: Confidence;
  sources: Source[];
  scanned_at: string;
  input: ScanRequest;
}

// Marketplace identifier — PRD §3.1 calls this out as one of the four fields
// to extract during input normalization. Used by marketplace-aware scrapers to
// decide whether they should run for this URL.
export type Marketplace =
  | "shopee-ph"
  | "lazada-ph"
  | "tiktok-shop"
  | "amazon"
  | "ebay"
  | "facebook-marketplace"
  | null;

// Result of input normalization (PRD §3.1). Constructed by apps/api/src/normalize.ts
// from a raw URL. Carries enough context for marketplace-specific scrapers to
// fetch the right seller/product pages.
export interface NormalizedInput {
  url: string;                  // original URL (cleaned, trailing slashes etc.)
  domain: string;               // registrable domain, e.g. "shopee.ph"
  marketplace: Marketplace;     // null when URL isn't on a known marketplace
  shop_id: string | null;       // marketplace-specific seller/shop identifier
  item_id: string | null;       // marketplace-specific product/listing identifier
}

export interface ScrapeJob {
  scan_id: string;
  source: string;
  target_url: string;
  // Normalized fields — populated by the input-normalization step at the API
  // gateway before fan-out. Scrapers can use these directly without re-parsing.
  domain: string;
  marketplace: Marketplace;
  shop_id: string | null;
  item_id: string | null;
  // Legacy optional fields kept for backward compatibility with scrapers that
  // already accept enriched context (e.g. price-sanity using `product`).
  seller?: string;
  product?: string;
}

export interface Signal {
  type: SignalType;
  weight: number;
  detail: string;
  source: Source;
}

export interface ScrapeResult {
  source: string;
  job_id: string;
  signals: Signal[];
  scraped_at: string;
}
