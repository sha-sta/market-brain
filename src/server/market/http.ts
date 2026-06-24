import "server-only";
import { reportError } from "@/lib/observability";

// Shared HTTP helper for every market adapter: AbortController timeout, reportError on a real failure,
// and degrade to null on ANY error or non-2xx. A market-data outage must NEVER crash the cron — a
// thin/empty result just means a quieter brief, never a fabricated number.

export async function getJson(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; scope: string },
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", ...opts.headers },
    });
    if (!res.ok) {
      // 404 = provider doesn't cover this symbol/cik (expected). Surface the rest (esp. 429 limits).
      if (res.status !== 404) {
        reportError(new Error(`${opts.scope} ${res.status}`), { scope: opts.scope, status: res.status });
      }
      return null;
    }
    return await res.json();
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) reportError(e, { scope: opts.scope });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON with an API key header; degrade to null on any error/non-2xx (same posture as getJson).
 *  Used by the Exa web-search adapter. */
export async function postJson(
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string>; timeoutMs?: number; scope: string },
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json", ...opts.headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status !== 404) reportError(new Error(`${opts.scope} ${res.status}`), { scope: opts.scope, status: res.status });
      return null;
    }
    return await res.json();
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) reportError(e, { scope: opts.scope });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip HTML to readable text: drop script/style, tags, entities; collapse whitespace. Pure. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch a page and return stripped text, bounded by maxBytes. Skips non-HTML content types. Degrades
 *  to null on any error/non-2xx. Custom UA. Used by the research loop's article fetch. */
export async function getText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; scope: string; maxBytes?: number },
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "error", // never follow a 3xx server-side: a public URL could redirect to an internal host (SSRF)
      headers: { "user-agent": "MarketBrain/1.0 (research)", ...opts.headers },
    });
    if (!res.ok) {
      if (res.status !== 404) reportError(new Error(`${opts.scope} ${res.status}`), { scope: opts.scope, status: res.status });
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) return null; // skip PDFs/binaries
    const raw = await res.text();
    const max = opts.maxBytes ?? 512_000;
    return stripHtml(raw.length > max ? raw.slice(0, max) : raw);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) reportError(e, { scope: opts.scope });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Coerce an unknown to a finite number, else null (never NaN / fabricated). An empty or whitespace
 *  string is NOT 0 — it's null (Number("") === 0 would fabricate a price/figure). */
export function num(v: unknown): number | null {
  const s = typeof v === "string" ? v.trim() : v;
  const n = typeof s === "string" ? (s === "" ? NaN : Number(s)) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Coerce an unknown to a non-empty trimmed string, else null. */
export function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
