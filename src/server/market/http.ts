import "server-only";
import { reportError } from "@/lib/observability";

// Shared HTTP helper for every market adapter: AbortController timeout, reportError on a real failure,
// and degrade to null on ANY error or non-2xx. A market-data outage must NEVER crash the cron — a
// thin/empty result just means a quieter brief, never a fabricated number. Mirrors brain's
// openalex-client fetchJson.

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

/** Coerce an unknown to a finite number, else null (never NaN / fabricated). */
export function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Coerce an unknown to a non-empty trimmed string, else null. */
export function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
