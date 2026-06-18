import "server-only";
import { postJson, getText, str } from "./http";
import { exaKey } from "@/lib/env";

// Open-web search + article fetch for GATED research jobs (Exa). Behind an injectable interface so a
// stub drives the research integration test and a different provider is a one-file swap. Dormant
// (returns []/null) when EXA_API_KEY is unset — research then re-reads the current graph only.

export interface WebSearchResult {
  title: string;
  url: string;
  publishedAt: string | null;
  snippet: string | null;
  text: string | null; // present when withText requested (Exa content extraction)
}

export interface WebSearchClient {
  search(query: string, opts?: { numResults?: number; category?: string; withText?: boolean }): Promise<WebSearchResult[]>;
  fetchArticle(url: string): Promise<{ url: string; title: string | null; text: string } | null>;
}

/** SSRF guard: only public http(s) URLs. Blocks loopback, link-local, cloud-metadata, and RFC-1918
 *  private ranges so a fetched/returned URL can't pivot into internal services. Pure (unit-tested). */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  // Raw IPv6 literals (Node keeps the brackets) are blocked WHOLESALE: legitimate article URLs use DNS
  // names, and bracketed forms hide loopback (::1), link-local (fe80), ULA (fc/fd), and the IPv4-mapped
  // bypass (::ffff:169.254.169.254 -> cloud metadata). Blocking all of them is simplest + safe.
  if (h.startsWith("[") || h.includes(":")) return false;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false; // loopback / private / link-local / this-host
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false; // 172.16-31.x
  return true;
}

function parseResult(r: unknown): WebSearchResult | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const url = str(o.url);
  if (!url || !isPublicHttpUrl(url)) return null;
  return {
    title: str(o.title) ?? url,
    url,
    publishedAt: str(o.publishedDate) ?? str(o.published_at),
    snippet: str(o.snippet),
    text: str(o.text),
  };
}

export function exaClient(): WebSearchClient {
  const key = exaKey();
  return {
    async search(query, opts = {}) {
      if (!key || !query.trim()) return [];
      // Exa /search (verify against current Exa docs before enabling): x-api-key header, results[] with
      // title/url/publishedDate and optional extracted text. Capped at 10 results.
      const body: Record<string, unknown> = { query, numResults: Math.min(opts.numResults ?? 6, 10), type: "auto" };
      if (opts.category) body.category = opts.category;
      if (opts.withText !== false) body.contents = { text: { maxCharacters: 4000 } };
      const data = await postJson("https://api.exa.ai/search", body, { headers: { "x-api-key": key }, scope: "exa.search" });
      const results = (data as { results?: unknown[] } | null)?.results;
      if (!Array.isArray(results)) return [];
      return results.map(parseResult).filter((r): r is WebSearchResult => r !== null);
    },
    async fetchArticle(url) {
      if (!isPublicHttpUrl(url)) return null; // SSRF guard
      const text = await getText(url, { scope: "fetchArticle" });
      return text ? { url, title: null, text: text.slice(0, 12000) } : null; // bound extraction cost
    },
  };
}
