import "server-only";
import { finnhubKey } from "@/lib/env";
import { canonicalizeUrl } from "@/server/normalize/dedupe";
import { getJson, num, str } from "./http";
import type { CompanyProfile, NewsArticle, Quote } from "./types";

// Finnhub — the primary quote + company-news source (free tier 60 req/min). Every method returns
// null/[] when the key is missing (dormant) or the call fails (degrade). https://finnhub.io/docs/api

const BASE = "https://finnhub.io/api/v1";

export interface FinnhubClient {
  quote(ticker: string): Promise<Quote | null>;
  profile(ticker: string): Promise<CompanyProfile | null>;
  companyNews(ticker: string, from: string, to: string): Promise<NewsArticle[]>;
}

export function finnhubClient(): FinnhubClient {
  return {
    async quote(ticker) {
      const k = finnhubKey();
      if (!k) return null;
      const sym = ticker.toUpperCase();
      const raw = await getJson(`${BASE}/quote?symbol=${encodeURIComponent(sym)}&token=${k}`, { scope: "finnhub.quote" });
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const price = num(r.c);
      if (price === null || price === 0) return null; // finnhub returns c=0 for an unknown symbol
      // marketCap lives on profile2; liveMarketDeps backfills it when a caller needs it.
      return { ticker: sym, price, changePct: num(r.dp), marketCap: null };
    },

    async profile(ticker) {
      const k = finnhubKey();
      if (!k) return null;
      const sym = ticker.toUpperCase();
      const raw = await getJson(`${BASE}/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${k}`, { scope: "finnhub.profile" });
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      if (!r.name && !r.ticker) return null;
      return {
        ticker: sym,
        name: str(r.name),
        exchange: str(r.exchange),
        sector: str(r.finnhubIndustry),
        cik: null,
        marketCap: num(r.marketCapitalization), // in millions USD
        website: str(r.weburl),
      };
    },

    async companyNews(ticker, from, to) {
      const k = finnhubKey();
      if (!k) return [];
      const sym = ticker.toUpperCase();
      const raw = await getJson(
        `${BASE}/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${k}`,
        { scope: "finnhub.news" },
      );
      if (!Array.isArray(raw)) return [];
      const out: NewsArticle[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const url = str(r.url);
        const headline = str(r.headline);
        if (!url || !headline) continue;
        out.push({
          headline,
          url: canonicalizeUrl(url),
          source: str(r.source),
          summary: str(r.summary),
          publishedAt: typeof r.datetime === "number" ? new Date(r.datetime * 1000).toISOString() : null,
          tickers: [sym],
        });
      }
      return out;
    },
  };
}
