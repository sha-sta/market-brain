import "server-only";
import { finnhubClient } from "./finnhub";
import { fmpClient } from "./fmp";
import { alphaVantageClient } from "./alphavantage";
import { edgarClient } from "./edgar";
import type { MarketDeps } from "./types";

export type { MarketDeps, Quote, NewsArticle, CompanyProfile, EarningsEvent, RatingChange, Filing } from "./types";

/** Live market deps assembled from the free-tier providers. Each method degrades to null/[] when its
 *  key is missing or the call fails, so this ALWAYS returns a full MarketDeps — a feature just lies
 *  dormant. Finnhub is primary for quotes + news; FMP for profile/earnings/ratings; Alpha Vantage is a
 *  news fallback (25/day); EDGAR (keyless, UA-gated) for filings. Tests inject a stub MarketDeps
 *  instead of calling this. */
export function liveMarketDeps(): MarketDeps {
  const fh = finnhubClient();
  const fmp = fmpClient();
  const av = alphaVantageClient();
  const edgar = edgarClient();
  return {
    async quote(ticker) {
      const q = await fh.quote(ticker);
      if (!q) return null;
      if (q.marketCap === null) {
        const p = await fh.profile(ticker);
        if (p?.marketCap != null) q.marketCap = p.marketCap * 1_000_000; // finnhub mktcap is in $M
      }
      return q;
    },
    async news(ticker, from, to) {
      const a = await fh.companyNews(ticker, from, to);
      if (a.length) return a;
      return av.newsSentiment([ticker]); // fallback only when Finnhub is empty/dormant (AV is 25/day)
    },
    async profile(ticker) {
      return (await fmp.profile(ticker)) ?? (await fh.profile(ticker));
    },
    earnings: (from, to) => fmp.earningsCalendar(from, to),
    ratings: (ticker) => fmp.ratings(ticker),
    filings: (cik, forms) => edgar.recentFilings(cik, forms),
  };
}
