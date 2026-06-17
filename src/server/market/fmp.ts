import "server-only";
import { fmpKey } from "@/lib/env";
import { normCik } from "@/server/normalize/dedupe";
import { getJson, num, str } from "./http";
import type { CompanyProfile, EarningsEvent, RatingChange } from "./types";

// Financial Modeling Prep — company profile (cik/sector/exchange), earnings calendar, and
// rating/price-target changes (free tier 250 req/day). Dormant/degrades like the other adapters.

const BASE = "https://financialmodelingprep.com/api";

export interface FmpClient {
  profile(ticker: string): Promise<CompanyProfile | null>;
  earningsCalendar(from: string, to: string): Promise<EarningsEvent[]>;
  ratings(ticker: string): Promise<RatingChange[]>;
}

export function fmpClient(): FmpClient {
  return {
    async profile(ticker) {
      const k = fmpKey();
      if (!k) return null;
      const sym = ticker.toUpperCase();
      const raw = await getJson(`${BASE}/v3/profile/${encodeURIComponent(sym)}?apikey=${k}`, { scope: "fmp.profile" });
      const first = Array.isArray(raw) ? raw[0] : null;
      if (!first || typeof first !== "object") return null;
      const o = first as Record<string, unknown>;
      return {
        ticker: sym,
        name: str(o.companyName),
        exchange: str(o.exchangeShortName) ?? str(o.exchange),
        sector: str(o.sector),
        cik: o.cik ? normCik(o.cik) || null : null,
        marketCap: num(o.mktCap),
        website: str(o.website),
      };
    },

    async earningsCalendar(from, to) {
      const k = fmpKey();
      if (!k) return [];
      const raw = await getJson(`${BASE}/v3/earning_calendar?from=${from}&to=${to}&apikey=${k}`, { scope: "fmp.earnings" });
      if (!Array.isArray(raw)) return [];
      const out: EarningsEvent[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const ticker = str(o.symbol);
        const date = str(o.date);
        if (!ticker || !date) continue;
        out.push({ ticker: ticker.toUpperCase(), date, epsEstimate: num(o.epsEstimated) });
      }
      return out;
    },

    async ratings(ticker) {
      const k = fmpKey();
      if (!k) return [];
      const sym = ticker.toUpperCase();
      // Price-target changes. Premium on some plans — degrades to [] on 403/empty.
      const raw = await getJson(`${BASE}/v4/price-target?symbol=${encodeURIComponent(sym)}&apikey=${k}`, { scope: "fmp.ratings" });
      if (!Array.isArray(raw)) return [];
      const out: RatingChange[] = [];
      for (const item of raw.slice(0, 10)) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const date = str(o.publishedDate) ?? str(o.date);
        if (!date) continue;
        out.push({
          ticker: sym,
          date,
          from: null,
          to: str(o.newGrade),
          firm: str(o.analystCompany) ?? str(o.analystName),
          priceTarget: num(o.priceTarget),
        });
      }
      return out;
    },
  };
}
