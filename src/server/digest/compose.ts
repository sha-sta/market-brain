// Compose the morning brief HTML from gathered graph deltas. PURE: the LLM summarizer is INJECTED
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

export interface BriefData {
  date: string; // ET date, YYYY-MM-DD
  movers: Mover[];
  news: NewsItem[];
  filings: FilingItem[];
  alerts: string[];
  connections: Connection[];
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
  "MarketBrain aggregates and surfaces what changed on the names you follow. It never recommends buying or selling — you form your own view.";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function isEmpty(d: BriefData): boolean {
  return d.movers.length === 0 && d.news.length === 0 && d.filings.length === 0 && d.alerts.length === 0;
}

function moversHtml(movers: Mover[]): string {
  if (movers.length === 0) return "";
  const rows = movers
    .map((m) => {
      const up = (m.changePct ?? 0) >= 0;
      const arrow = up ? "▲" : "▼";
      const color = up ? "#1a7f4b" : "#a32f2f";
      const price = m.price === null ? "" : ` · $${m.price.toFixed(2)}`;
      return `<li><strong>${esc(m.title)}</strong> <span style="color:#6b675f">(${esc(m.ticker)})</span> <span style="color:${color}">${arrow} ${esc(pct(m.changePct))}</span>${esc(price)}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">Price moves</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function newsHtml(news: NewsItem[]): string {
  if (news.length === 0) return "";
  const rows = news
    .map((n) => {
      const link = n.url ? `<a href="${esc(n.url)}" style="color:#1c1b19">${esc(n.headline)}</a>` : esc(n.headline);
      const meta = [n.source, n.sentiment, n.materiality ? `${n.materiality} materiality` : null]
        .filter(Boolean)
        .map((x) => esc(String(x)))
        .join(" · ");
      const ment = n.mentions.length ? `<br><span style="color:#6b675f;font-size:13px">on ${n.mentions.map(esc).join(", ")}</span>` : "";
      return `<li style="margin-bottom:8px">${link}${meta ? `<br><span style="color:#6b675f;font-size:13px">${meta}</span>` : ""}${ment}</li>`;
    })
    .join("");
  return `<h3 style="margin:18px 0 6px">What changed on your names</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function connectionsHtml(connections: Connection[]): string {
  if (connections.length === 0) return "";
  const rows = connections
    .map((c) => `<li><strong>${esc(c.entity)}</strong> appears across ${c.holdings.length} of your holdings <span style="color:#6b675f">(${c.holdings.map(esc).join(", ")})</span></li>`)
    .join("");
  return `<h3 style="margin:18px 0 6px">Connections</h3><ul style="margin:0;padding-left:18px">${rows}</ul>`;
}

function filingsHtml(filings: FilingItem[]): string {
  if (filings.length === 0) return "";
  const rows = filings
    .map((f) => {
      const label = `${esc(f.formType)}${f.company ? ` — ${esc(f.company)}` : ""}`;
      return `<li>${f.url ? `<a href="${esc(f.url)}" style="color:#1c1b19">${label}</a>` : label}</li>`;
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
  return d.movers.length + d.news.length + d.filings.length + d.alerts.length;
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
      if (s) intro = `<p style="margin:0 0 10px">${s}</p>`;
    } catch {
      // template-only fallback — the gathered data is still useful on its own.
    }
  }
  if (!intro) {
    intro = empty
      ? `<p style="margin:0 0 10px">A quiet morning — nothing material moved on the names you follow. The graph is watching.</p>`
      : `<p style="margin:0 0 10px">Here's what moved on the names you follow.</p>`;
  }

  const sections = [
    moversHtml(data.movers),
    newsHtml(data.news),
    connectionsHtml(data.connections),
    filingsHtml(data.filings),
    alertsHtml(data.alerts),
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<div style="max-width:620px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;color:#1c1b19;background:#faf9f6;padding:24px">
  <div style="font-size:22px;font-weight:600;border-bottom:1px solid #e7e4dc;padding-bottom:10px;margin-bottom:14px">MarketBrain — ${esc(data.date)}</div>
  ${intro}
  ${sections}
  <p style="margin-top:22px;padding-top:12px;border-top:1px solid #e7e4dc;color:#6b675f;font-size:12px">${esc(FOOTER)}</p>
</div>`;

  return { subject, html };
}
