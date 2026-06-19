// Compose the morning brief HTML from gathered graph deltas. Dark "terminal card" theme to match the
// app (a self-contained dark panel with inline colors so it renders consistently in mail clients and
// on /brief). PURE: the LLM summarizer is INJECTED
// (deps.summarize), so section selection / ordering / empty-state / the no-advice footer are all
// unit-tested without a live model. If summarize is absent (or fails), the brief is template-only —
// the gathered data alone is useful (the documented fallback). The brief NEVER recommends buy/sell;
// it aggregates and surfaces so the reader forms his own view.

export interface Mover {
  title: string;
  ticker: string;
  price: number | null;
  changePct: number | null;
}

export interface NewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  sentiment: string | null; // bullish | bearish | neutral
  materiality: string | null; // high | med | low
  mentions: string[]; // holding titles this article names
}

export interface FilingItem {
  formType: string;
  company: string | null;
  url: string | null;
}

export interface Connection {
  entity: string; // e.g. "TSMC"
  holdings: string[]; // holdings it connects to
}

export interface ThesisCheck {
  nodeId: string;
  title: string;
  strength: string; // unsupported | weak | contested | supported | well-supported
  bearCase: string;
  confirming: number;
  challenging: number;
}

export interface BriefData {
  date: string; // ET date, YYYY-MM-DD
  movers: Mover[];
  news: NewsItem[];
  filings: FilingItem[];
  alerts: string[];
  connections: Connection[];
  thesisChecks?: ThesisCheck[]; // strict-critic verdicts re-judged this cycle (weak/contested first)
}

export interface ComposeDeps {
  /** Optional LLM intro: a short, factual, NON-advisory paragraph summarizing the day. Injected so
   *  compose stays pure + testable; returns plain text/HTML. */
  summarize?: (data: BriefData) => Promise<string>;
}

export interface ComposedBrief {
  subject: string;
  html: string;
}

const FOOTER =
  "MarketBrain aggregates and surfaces what changed on the names you follow. It never recommends buying or selling; you form your own view.";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only allow http(s) hrefs. News/filing URLs come from external feeds (Finnhub/EDGAR), so a
 *  `javascript:`/`data:` URL must NOT become a clickable link in the brief (rendered via
 *  dangerouslySetInnerHTML on /brief) — `esc` doesn't touch those schemes. Returns null to render
 *  plain text instead of an anchor. */
function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function isEmpty(d: BriefData): boolean {
  return (
    d.movers.length === 0 &&
    d.news.length === 0 &&
    d.filings.length === 0 &&
    d.alerts.length === 0 &&
    (d.thesisChecks?.length ?? 0) === 0
  );
}

function moversHtml(movers: Mover[]): string {
  if (movers.length === 0) return "";
  const rows = movers
    .map((m) => {
      const up = (m.changePct ?? 0) >= 0;
      const arrow = up ? "▲" : "▼";
      const color = up ? "#3fb27f" : "#e5685f";
      const price = m.price === null ? "" : ` · $${m.price.toFixed(2)}`;
      return `<li><strong>${esc(m.title)}</strong> <span style="color:#8d939b">(${esc(m.ticker)})</span> <span style="color:${color}">${arrow} ${esc(pct(m.changePct))}</span>${esc(price)}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">Price moves</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function newsHtml(news: NewsItem[]): string {
  if (news.length === 0) return "";
  const rows = news
    .map((n) => {
      const href = safeHref(n.url);
      const link = href ? `<a href="${esc(href)}" style="color:#ececed">${esc(n.headline)}</a>` : esc(n.headline);
      const meta = [n.source, n.sentiment, n.materiality ? `${n.materiality} materiality` : null]
        .filter(Boolean)
        .map((x) => esc(String(x)))
        .join(" · ");
      const ment = n.mentions.length ? `<br><span style="color:#8d939b;font-size:13px">on ${n.mentions.map(esc).join(", ")}</span>` : "";
      return `<li style="margin-bottom:8px">${link}${meta ? `<br><span style="color:#8d939b;font-size:13px">${meta}</span>` : ""}${ment}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">What changed on your names</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function connectionsHtml(connections: Connection[]): string {
  if (connections.length === 0) return "";
  const rows = connections
    .map((c) => `<li><strong>${esc(c.entity)}</strong> appears across ${c.holdings.length} of your holdings <span style="color:#8d939b">(${c.holdings.map(esc).join(", ")})</span></li>`)
    .join("");
  return `<h3 style="margin:18px 0 6px">Connections</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

const STRENGTH_COLOR: Record<string, string> = {
  unsupported: "#e5685f",
  weak: "#e5685f",
  contested: "#d9a441",
  supported: "#3fb27f",
  "well-supported": "#3fb27f",
};

function thesisChecksHtml(checks: ThesisCheck[]): string {
  if (checks.length === 0) return "";
  const rows = checks
    .map((c) => {
      const color = STRENGTH_COLOR[c.strength] ?? "#8d939b";
      const badge = `<span style="color:${color};font-weight:600">${esc(c.strength)}</span>`;
      const counts = `<span style="color:#8d939b">(${c.confirming} for / ${c.challenging} against)</span>`;
      const bear = c.bearCase ? `<br><span style="color:#8d939b;font-size:13px">Bear case: ${esc(c.bearCase)}</span>` : "";
      return `<li style="margin-bottom:8px"><strong>${esc(c.title)}</strong> · ${badge} ${counts}${bear}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">Thesis check-ins</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function filingsHtml(filings: FilingItem[]): string {
  if (filings.length === 0) return "";
  const rows = filings
    .map((f) => {
      const label = `${esc(f.formType)}${f.company ? ` · ${esc(f.company)}` : ""}`;
      const href = safeHref(f.url);
      return `<li>${href ? `<a href="${esc(href)}" style="color:#ececed">${label}</a>` : label}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">Filings</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function alertsHtml(alerts: string[]): string {
  if (alerts.length === 0) return "";
  const rows = alerts.map((a) => `<li>${esc(a)}</li>`).join("");
  return `<h3 style="margin:18px 0 6px">Alerts</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

/** Count the surfaced updates (drives the subject line). */
function updateCount(d: BriefData): number {
  return d.movers.length + d.news.length + d.filings.length + d.alerts.length + (d.thesisChecks?.length ?? 0);
}

export async function composeBrief(data: BriefData, deps: ComposeDeps = {}): Promise<ComposedBrief> {
  const empty = isEmpty(data);
  const count = updateCount(data);
  const subject = empty
    ? `MarketBrain · ${data.date} · a quiet day`
    : `MarketBrain · ${data.date} · ${count} update${count === 1 ? "" : "s"} on your names`;

  let intro = "";
  if (deps.summarize) {
    try {
      const s = (await deps.summarize(data)).trim();
      // esc() the LLM intro: it's prompt-instructed to be plain text, and the brief is rendered via
      // dangerouslySetInnerHTML — so any tag/entity (hallucinated or injected via graph content) is neutralized.
      if (s) intro = `<p style="margin:0 0 10px">${esc(s)}</p>`;
    } catch {
      // template-only fallback — the gathered data is still useful on its own.
    }
  }
  if (!intro) {
    intro = empty
      ? `<p style="margin:0 0 10px">A quiet morning. Nothing material moved on the names you follow. The graph is watching.</p>`
      : `<p style="margin:0 0 10px">Here's what moved on the names you follow.</p>`;
  }

  const sections = [
    moversHtml(data.movers),
    thesisChecksHtml(data.thesisChecks ?? []),
    newsHtml(data.news),
    connectionsHtml(data.connections),
    filingsHtml(data.filings),
    alertsHtml(data.alerts),
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<div style="max-width:620px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;color:#ececed;background:#16191c;border:1px solid #262a2f;border-radius:8px;padding:24px">
  <div style="font-size:22px;font-weight:600;border-bottom:1px solid #262a2f;padding-bottom:10px;margin-bottom:14px">MarketBrain · ${esc(data.date)}</div>
  ${intro}
  ${sections}
  <p style="margin-top:22px;padding-top:12px;border-top:1px solid #262a2f;color:#8d939b;font-size:12px">${esc(FOOTER)}</p>
</div>`;

  return { subject, html };
}
