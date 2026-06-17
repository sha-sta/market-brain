import "server-only";
import { alphaVantageKey } from "@/lib/env";
import { canonicalizeUrl } from "@/server/normalize/dedupe";
import { getJson, str } from "./http";
import type { NewsArticle } from "./types";

// Alpha Vantage NEWS_SENTIMENT. The free tier is 25 calls/DAY (severe), so this is a FALLBACK only —
// used when Finnhub returns nothing for a ticker. Dormant when the key is unset.

const BASE = "https://www.alphavantage.co/query";

export interface AlphaVantageClient {
  newsSentiment(tickers: string[]): Promise<NewsArticle[]>;
}

export function alphaVantageClient(): AlphaVantageClient {
  return {
    async newsSentiment(tickers) {
      const k = alphaVantageKey();
      if (!k || tickers.length === 0) return [];
      const syms = tickers.map((t) => t.toUpperCase()).join(",");
      const raw = await getJson(
        `${BASE}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(syms)}&limit=20&apikey=${k}`,
        { scope: "alphavantage.news" },
      );
      if (!raw || typeof raw !== "object") return [];
      const feed = (raw as { feed?: unknown }).feed;
      if (!Array.isArray(feed)) return []; // a rate-limit response has { Note/Information } instead of feed
      const out: NewsArticle[] = [];
      for (const item of feed) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const url = str(o.url);
        const headline = str(o.title);
        if (!url || !headline) continue;
        const ts = Array.isArray(o.ticker_sentiment) ? o.ticker_sentiment : [];
        const arts = ts
          .map((x) => (x && typeof x === "object" ? str((x as Record<string, unknown>).ticker) : null))
          .filter((x): x is string => !!x)
          .map((s) => s.toUpperCase());
        out.push({
          headline,
          url: canonicalizeUrl(url),
          source: str(o.source),
          summary: str(o.summary),
          publishedAt: parseAvTime(str(o.time_published)),
          tickers: arts.length ? arts : tickers.map((t) => t.toUpperCase()),
        });
      }
      return out;
    },
  };
}

// AV timestamps look like "20240131T143000".
function parseAvTime(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z` : null;
}
