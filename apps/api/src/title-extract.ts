import Groq from "groq-sdk";
import { env } from "./env";

// Pulls a product title (and best-effort price) out of OCR'd marketplace
// screenshot text. Used by /scan/image as the bridge step when:
//   1. OCR found no URL in the screenshot (TikTok Shop is in-app only, etc.)
//   2. But detectScreenshotMarketplace() classified the chrome as a known
//      marketplace, so we know what the user was looking at
//
// The extracted title becomes the search query for marketplace-search.ts —
// we site-filter Google CSE to the detected marketplace and hopefully get
// back a canonical product URL the normal scan pipeline can scrape.
//
// Why an LLM and not regex: OCR text from a marketplace screenshot is a
// mess of UI chrome (Buy Now / Add to basket / shipping badges / prices /
// ratings / "1/9" carousel counters) wrapped around the actual title. The
// title is usually the longest natural-language line but heuristics break
// down on multi-line titles, embedded brand brackets like "【Venous】", and
// noisy OCR. Groq llama-3.1-8b is fast (~300ms), cheap (~$0.0005/call),
// and reliable at "pull out the product title" — it's the smallest useful
// hammer we have on hand.

const EXTRACT_MODEL = "llama-3.1-8b-instant";
const MAX_OUTPUT_TOKENS = 256;

const SYSTEM_PROMPT = `You extract the product title from OCR'd text scraped from an online marketplace product page screenshot (TikTok Shop, Shopee, Lazada, etc.). The OCR text contains UI chrome (buttons, badges, prices, ratings, image counters) interleaved with the actual product title.

Your job: return ONLY the product title as a clean search query — the text a shopper would search for if they wanted to find this exact product.

Rules:
- Strip the brand-bracket noise like "【Brand】" or "[Brand]" at the start of titles — keep the brand name, drop the brackets.
- Strip marketplace UI fragments: "Mall", "Add to basket", "Buy now", "Shop", "Chat", "Free Shipping", "MEGA Discount", "100% Authentic", "Free X-day Return", "Select options", "Color, Size".
- Strip prices ("P 448.00"), discount badges ("-63%"), ratings ("4.5 / 5"), and sold counts ("666 sold").
- Strip image-counter chrome ("1/9").
- Strip emoji and decorative unicode.
- Keep the brand name AND the descriptive product words. Both matter for search.
- If you cannot find a recognizable product title in the text, return an empty string. Do NOT invent one.
- Return JSON only: {"title": "...", "price_php": <number or null>}

The price field is best-effort — extract the LISTING price in PHP (typically prefixed "P " or "₱"). If you see a struck-through original price next to a current price, return the CURRENT (lower) price. Return null if no price is visible.

Examples:

Input: "1/9 P 448.00 P 1,200.00 -63% Mall 【Venous】2025 New White Shoes for Men Original Low Cut Rubber Men Shoes Casual Sneakers for Men 4.5 / 5 (61) 666 sold Shop Chat Add to basket Buy now"
Output: {"title": "Venous 2025 New White Shoes for Men Original Low Cut Rubber Sneakers", "price_php": 448}

Input: "Shopee Mall Add to Cart Buy Now P 999 4.8 (1.2k) Apple iPhone 15 Pro Max 256GB Natural Titanium Free Shipping COD Available"
Output: {"title": "Apple iPhone 15 Pro Max 256GB Natural Titanium", "price_php": 999}

Input: "random text with no product"
Output: {"title": "", "price_php": null}`;

const client = new Groq({ apiKey: env.GROQ_API_KEY });

export interface ExtractedTitle {
  title: string;
  price_php: number | null;
}

export async function extractTitleFromOcr(ocrText: string): Promise<ExtractedTitle> {
  // Short-circuit: nothing meaningful to extract. Avoids burning a Groq call
  // on a near-empty image (camera misfire, all-white screenshot, etc.).
  if (!ocrText || ocrText.trim().length < 10) {
    return { title: "", price_php: null };
  }

  try {
    const response = await client.chat.completions.create({
      model: EXTRACT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: ocrText.slice(0, 2000) },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text) return { title: "", price_php: null };

    const parsed = JSON.parse(text) as unknown;
    return validate(parsed);
  } catch (err) {
    // Groq outage, rate limit, malformed JSON, etc. — the bridge is a nice-to-
    // have, not a primary path. Fall through silently and let /scan/image
    // return the existing "Not Enough Info" hint instead of 500ing.
    console.error(`[title-extract] failed: ${(err as Error).message}`);
    return { title: "", price_php: null };
  }
}

function validate(raw: unknown): ExtractedTitle {
  if (!raw || typeof raw !== "object") return { title: "", price_php: null };
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  // Reject extremely short / extremely long titles. Search engines weight
  // word count, and a 2-character "title" is almost certainly a model
  // hallucination from sparse OCR. 300 chars is well past any real product
  // title; longer values usually mean the model concatenated multiple lines.
  if (title.length < 8 || title.length > 300) {
    return { title: "", price_php: priceFromUnknown(o.price_php) };
  }
  return { title, price_php: priceFromUnknown(o.price_php) };
}

function priceFromUnknown(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
