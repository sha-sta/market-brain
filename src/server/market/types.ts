// The market-data contract. Every adapter maps its provider's payload into these neutral shapes, and
// the daily cron + enricher depend only on `MarketDeps` — so a provider can be swapped or stubbed
// (tests inject a fake MarketDeps). Numeric fields are nullable:
// a missing value degrades to null, never a fabricated number.

export interface Quote {
  ticker: string;
  price: number | null;
  changePct: number | null; // day change %
  marketCap: number | null;
}

export interface NewsArticle {
  headline: string;
  url: string; // canonicalized by the caller before use as a dedupe key
  source: string | null;
  summary: string | null;
  publishedAt: string | null; // ISO
  tickers: string[]; // raw ticker symbols the article is about
}

export interface CompanyProfile {
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null; // raw label (NOT a [[wikilink]])
  cik: string | null;
  marketCap: number | null;
  website: string | null;
}

export interface EarningsEvent {
  ticker: string;
  date: string; // ISO date
  epsEstimate: number | null;
}

export interface RatingChange {
  ticker: string;
  date: string;
  from: string | null;
  to: string | null;
  firm: string | null;
  priceTarget: number | null;
}

export interface Filing {
  cik: string;
  accession: string; // dashed form, e.g. 0001045810-24-000123
  formType: string; // 8-K, 4, 10-Q, ...
  filedAt: string; // ISO date
  url: string;
  title: string | null;
}

/**
 * The dependency surface the cron + enricher consume. quote/news/profile are always present (each
 * degrades to null/[] when its provider key is missing). earnings/ratings/filings are optional so a
 * stub MarketDeps can omit them.
 */
export interface MarketDeps {
  quote(ticker: string): Promise<Quote | null>;
  news(ticker: string, from: string, to: string): Promise<NewsArticle[]>;
  profile(ticker: string): Promise<CompanyProfile | null>;
  earnings?(from: string, to: string): Promise<EarningsEvent[]>;
  ratings?(ticker: string): Promise<RatingChange[]>;
  filings?(cik: string, formTypes: string[]): Promise<Filing[]>;
}
