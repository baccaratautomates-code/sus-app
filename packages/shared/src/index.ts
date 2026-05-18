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

export interface ScrapeJob {
  scan_id: string;
  source: string;
  target_url: string;
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
