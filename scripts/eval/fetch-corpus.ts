import { config } from "dotenv";
// Load feature keys before anything reads them (mirrors scripts/seed.ts). Self-contained: this fetcher
// hits Finnhub + SEC EDGAR directly (the exact requests src/server/market/{finnhub,edgar}.ts make) so it
// runs under plain tsx with no `@/` alias or `server-only` barrier, and needs only FINNHUB_API_KEY +
// SEC_EDGAR_UA — never the AI Gateway or the DB.
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CorpusDoc, CorpusManifest } from "./types";

// A FIXED basket of large-caps (ticker + SEC CIK). Pinning the basket + window is what makes the corpus
// reproducible: fetched once, committed, replayed forever. Recorded in manifest.json.
const BASKET: Array<{ ticker: string; cik: string }> = [
  { ticker: "NVDA", cik: "1045810" },
  { ticker: "AAPL", cik: "320193" },
  { ticker: "MSFT", cik: "789019" },
  { ticker: "TSLA", cik: "1318605" },
  { ticker: "AMZN", cik: "1018724" },
  { ticker: "META", cik: "1326801" },
  { ticker: "GOOGL", cik: "1652044" },
  { ticker: "JPM", cik: "19617" },
  { ticker: "XOM", cik: "34088" },
  { ticker: "AMD", cik: "2488" },
];
const NEWS_PER_TICKER = 3;
const NEWS_WINDOW_DAYS = 30;
const FILING_FORMS = ["8-K", "10-Q", "10-K"];
const FILING_BODY_MAX_CHARS = 6000; // bound extractor cost; the pipeline chunks anyway
// When Finnhub news is available we only need a few filings for variety; when it's absent, the corpus is
// filings-only, so scale SEC coverage across the whole basket to still hit the ~30-40 doc target.
const FILING_TICKERS_WITH_NEWS = ["NVDA", "AAPL", "TSLA", "JPM"];
const FILINGS_PER_TICKER_WITH_NEWS = 2;
const FILINGS_PER_TICKER_SEC_ONLY = 4;

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // iXBRL context/unit/hidden-fact definitions live in these blocks — remove them before the general
    // tag strip so the readable 8-K/10-Q prose isn't buried under machine metadata.
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ") // any other numeric entity -> space
    .replace(/&[a-z]+;/gi, " ") // any other named entity -> space
    // SEC primary docs are inline-XBRL: strip leftover taxonomy qnames (e.g. us-gaap:CommonStockMember,
    // aapl:IPadMember, iso4217:USD) so the extractor grounds in readable PROSE, not machine tags. A qname
    // is prefix:LocalName with NO space around the colon, so "HEADLINE: x" / "http://" are untouched.
    .replace(/\b[a-z][a-z0-9-]{1,20}:[A-Za-z][A-Za-z0-9_]+\b/g, " ")
    // Collapse residual XBRL-context RUNS of 2+ consecutive CIK (10-digit) / ISO-date tokens (the
    // leftover period/identifier lists). A single ISO date in prose survives — only runs are removed.
    .replace(/(?:\b\d{10}\b|\b\d{4}-\d{2}-\d{2}\b)(?:\s+(?:\b\d{10}\b|\b\d{4}-\d{2}-\d{2}\b))+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchNews(ticker: string, from: string, to: string, key: string): Promise<CorpusDoc[]> {
  const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${key}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    console.warn(`  ! finnhub ${ticker} ${res.status}`);
    return [];
  }
  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  const items = raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((r) => ({
      headline: String(r.headline ?? "").trim(),
      url: String(r.url ?? "").trim(),
      source: r.source ? String(r.source) : null,
      summary: String(r.summary ?? "").trim(),
      publishedAt: typeof r.datetime === "number" ? new Date(r.datetime * 1000).toISOString() : null,
    }))
    .filter((a) => a.headline && a.url && a.summary.length > 40) // need real body text to ground against
    .sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0))
    .slice(0, NEWS_PER_TICKER);

  return items.map((a, i) => {
    const raw_text = [
      `HEADLINE: ${a.headline}`,
      a.source ? `SOURCE: ${a.source}` : "",
      `URL: ${a.url}`,
      a.publishedAt ? `PUBLISHED: ${a.publishedAt}` : "",
      `TICKERS: ${ticker}`,
      "",
      a.summary,
    ]
      .filter((l) => l !== "")
      .join("\n");
    return {
      id: `news-${ticker.toLowerCase()}-${String(i + 1).padStart(2, "0")}`,
      kind: "news" as const,
      source_ref: a.url,
      ticker,
      raw_text,
      meta: { ticker, url: a.url, published_at: a.publishedAt ?? "", source: a.source ?? "" },
    };
  });
}

async function fetchFilings(
  ticker: string,
  cik: string,
  ua: string,
  perTicker: number,
): Promise<CorpusDoc[]> {
  const padded = cik.padStart(10, "0");
  const subRes = await fetch(`${SEC_SUBMISSIONS}/CIK${padded}.json`, {
    headers: { accept: "application/json", "user-agent": ua },
  });
  if (!subRes.ok) {
    console.warn(`  ! sec submissions ${ticker} ${subRes.status}`);
    return [];
  }
  const sub = (await subRes.json()) as Record<string, unknown>;
  const recent = (sub.filings as Record<string, unknown> | undefined)?.recent as Record<string, unknown> | undefined;
  if (!recent) return [];
  const acc = (recent.accessionNumber as string[]) ?? [];
  const form = (recent.form as string[]) ?? [];
  const filedDate = (recent.filingDate as string[]) ?? [];
  const primaryDoc = (recent.primaryDocument as string[]) ?? [];
  const want = new Set(FILING_FORMS.map((f) => f.toUpperCase()));

  const out: CorpusDoc[] = [];
  for (let i = 0; i < acc.length && out.length < perTicker; i += 1) {
    const f = String(form[i] ?? "");
    if (!want.has(f.toUpperCase())) continue;
    const accession = String(acc[i] ?? "");
    const date = String(filedDate[i] ?? "");
    const doc = String(primaryDoc[i] ?? "");
    if (!accession || !date || !doc) continue;
    const accNoDash = accession.replace(/-/g, "");
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${doc}`;
    await sleep(400); // be polite to SEC
    const bodyRes = await fetch(docUrl, { headers: { "user-agent": ua, accept: "text/html" } });
    if (!bodyRes.ok) {
      console.warn(`  ! sec doc ${ticker} ${accession} ${bodyRes.status}`);
      continue;
    }
    const body = stripHtml(await bodyRes.text()).slice(0, FILING_BODY_MAX_CHARS);
    if (body.length < 200) continue; // skip empty/binary primary docs
    const raw_text = [
      `FORM: ${f}`,
      `COMPANY: ${ticker}`,
      `CIK: ${cik}`,
      `ACCESSION: ${accession}`,
      `FILED: ${date}`,
      `URL: ${docUrl}`,
      "",
      body,
    ].join("\n");
    out.push({
      id: `filing-${ticker.toLowerCase()}-${f.replace(/[^a-z0-9]/gi, "").toLowerCase()}-${String(out.length + 1).padStart(2, "0")}`,
      kind: "filing",
      source_ref: docUrl,
      ticker,
      raw_text,
      meta: { ticker, cik, accession, form_type: f, filed_at: date, url: docUrl },
    });
  }
  return out;
}

async function main(): Promise<void> {
  const finnhubKey = process.env.FINNHUB_API_KEY; // secret; may be absent locally (lives in Vercel prod)
  // SEC EDGAR is keyless — it only needs a UA of the form "Name email@example.com" (NOT a secret). Fall
  // back to a valid self-identifying UA so filings are always fetchable without a stored key.
  const ua = process.env.SEC_EDGAR_UA || "MarketBrain-Eval yoonchristian2025@gmail.com";

  const now = new Date();
  const to = ymd(now);
  const from = ymd(new Date(now.getTime() - NEWS_WINDOW_DAYS * 86_400_000));
  console.log(`Fetching corpus  window=${from}..${to}  basket=${BASKET.map((b) => b.ticker).join(",")}`);

  const docs: CorpusDoc[] = [];
  if (finnhubKey) {
    for (const { ticker } of BASKET) {
      const news = await fetchNews(ticker, from, to, finnhubKey);
      console.log(`  news  ${ticker}: ${news.length}`);
      docs.push(...news);
    }
  } else {
    console.warn("  (FINNHUB_API_KEY absent — skipping news; SEC filings only)");
  }
  const filingTickers = finnhubKey ? BASKET.filter((b) => FILING_TICKERS_WITH_NEWS.includes(b.ticker)) : BASKET;
  const perTicker = finnhubKey ? FILINGS_PER_TICKER_WITH_NEWS : FILINGS_PER_TICKER_SEC_ONLY;
  for (const { ticker, cik } of filingTickers) {
    const filings = await fetchFilings(ticker, cik, ua, perTicker);
    console.log(`  filing ${ticker}: ${filings.length}`);
    docs.push(...filings);
  }

  if (docs.length === 0) throw new Error("Corpus empty — check API keys / rate limits");

  const manifest: CorpusManifest = {
    generatedAt: now.toISOString(),
    window: { from, to },
    basket: BASKET.map((b) => b.ticker),
    newsPerTicker: NEWS_PER_TICKER,
    docCount: docs.length,
    docs: docs.map((d) => ({ id: d.id, kind: d.kind, source_ref: d.source_ref, ticker: d.ticker, sha256: sha256(d.raw_text) })),
  };

  const dir = join(process.cwd(), "scripts/eval/corpus");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "docs.json"), JSON.stringify(docs, null, 2));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const news = docs.filter((d) => d.kind === "news").length;
  const filings = docs.filter((d) => d.kind === "filing").length;
  console.log(`\nPinned ${docs.length} docs (${news} news + ${filings} filings) -> scripts/eval/corpus/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
