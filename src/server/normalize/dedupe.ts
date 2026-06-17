// Entity de-duplication for the market graph. Cheap, explainable fuzzy matching: confident matches
// auto-merge; ambiguous matches are flagged for human review rather than silently merged. The worker
// additionally unions these candidates with pgvector neighbours before calling findDuplicate.
//
// HARD KEYS are the crux of merge-correctness. A ticker (company), CIK (company), canonical URL
// (news), or accession (filing) uniquely identifies a real thing: a MATCH on any of these overrides
// name fuzz; a CONFLICT (both present, different) BLOCKS a merge however similar the names. This is
// the guard against the top failure mode — an LLM-fabricated ticker merging two distinct companies.

import * as fuzz from "fuzzball";

// Score bands (token_sort_ratio, 0-100).
export const HIGH = 88; // >= HIGH      -> confident duplicate, merge
export const LOW = 72; //  LOW..HIGH-1  -> ambiguous, create new + flag for review
//                         < LOW         -> not a duplicate

export type Verdict = "match" | "ambiguous" | "none";

/** A comparison record: an entity's type + its {title, ...data} fields. */
export interface DedupeCandidate {
  type: string;
  fields: Record<string, unknown>;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Collapse whitespace, trim, lowercase. */
export function normKey(s: unknown): string {
  return str(s).trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strip a leading honorific so "Dr. Jane Doe" and "Jane Doe" key the same (person names only). */
export function stripHonorific(name: unknown): string {
  return str(name).replace(/^\s*(?:prof|dr|mrs|mr|ms|miss)\.?\s+/i, "").trim();
}

// --- Hard-key normalizers (exported so the market enricher stores keys in the EXACT form compared
//     here — a divergent normalization would silently break cross-source dedup). -------------------

/** Bare, upper-cased ticker. Strips an exchange prefix ("NASDAQ:NVDA" -> "NVDA"), a leading "$", and
 *  any surrounding whitespace. Returns "" if nothing ticker-like remains. NEVER guess a ticker from a
 *  name — this only normalizes one the source already gave verbatim. */
export function normTicker(raw: unknown): string {
  let t = str(raw).trim().toUpperCase();
  if (!t) return "";
  if (t.includes(":")) t = t.slice(t.lastIndexOf(":") + 1); // drop NASDAQ:/NYSE: style prefixes
  t = t.replace(/^\$/, "").trim();
  // A ticker is short alphanumerics with an optional class suffix (BRK.B). Reject anything else.
  return /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(t) ? t : "";
}

/** Bare, leading-zero-stripped CIK (SEC central index key). "0001045810" -> "1045810". "" if no digits. */
export function normCik(raw: unknown): string {
  const digits = str(raw).replace(/\D/g, "").replace(/^0+/, "");
  return digits;
}

/** Bare, dash-stripped SEC accession number. "0001045810-24-000123" -> "000104581024000123". */
export function normAccession(raw: unknown): string {
  return str(raw).replace(/[^0-9]/g, "");
}

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "spm", "_hsenc", "_hsmi",
]);

/** Canonicalize a URL so the same article from different links dedupes: lowercase host (drop "www."),
 *  drop the fragment, strip tracking params, sort the rest, drop a trailing slash. On parse failure,
 *  fall back to the trimmed lowercased raw. Exported — the cron canonicalizes source_ref identically. */
export function canonicalizeUrl(raw: unknown): string {
  const s = str(raw).trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    u.hash = "";
    u.host = u.host.toLowerCase().replace(/^www\./, "");
    u.protocol = u.protocol.toLowerCase();
    const kept: [string, string][] = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) kept.push([k, v]);
    }
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    u.search = "";
    for (const [k, v] of kept) u.searchParams.append(k, v);
    let out = u.toString();
    out = out.replace(/\/$/, ""); // drop trailing slash (path or after host)
    return out.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

/** A normalized string used to compare two entities of the same type (the fuzzy fallback key). */
export function comparisonKey(type: string, fields: Record<string, unknown>): string {
  const name = str(fields.name) || str(fields.title);
  switch (type) {
    case "company":
    case "sector":
    case "theme":
      return normKey(name);
    case "person":
      return normKey(`${stripHonorific(name)} ${str(fields.company)}`);
    case "news": {
      const date = str(fields.published_at).slice(0, 10); // YYYY-MM-DD: same headline same day -> dup
      return normKey(`${str(fields.headline) || name} ${date}`);
    }
    case "filing":
      return normKey(`${str(fields.form_type)} ${str(fields.company)} ${str(fields.filed_at).slice(0, 10)}`);
    case "thesis":
      return normKey(str(fields.statement) || name);
    default:
      return normKey(name || str(fields.statement) || str(fields.headline));
  }
}

/** Map a 0-100 similarity score to a verdict using the HIGH/LOW bands. */
export function classify(score: number): Verdict {
  if (score >= HIGH) return "match";
  if (score >= LOW) return "ambiguous";
  return "none";
}

/** token_sort_ratio over two already-normalized keys (0-100). */
export function fuzzyScore(a: string, b: string): number {
  return fuzz.token_sort_ratio(a, b);
}

export interface DuplicateResult<T extends DedupeCandidate> {
  best: T | null;
  verdict: Verdict;
  score: number;
}

export interface HardKeys {
  ticker?: string;
  cik?: string;
  url?: string;
  accession?: string;
}

/** Extract an entity's strong identity keys, scoped by type so a field never leaks across types
 *  (a company keys on ticker/cik; news on canonical url; filing on accession + url). Pure. */
export function extractHardKeys(type: string, fields: Record<string, unknown>): HardKeys {
  const out: HardKeys = {};
  if (type === "company") {
    const ticker = normTicker(fields.ticker);
    if (ticker) out.ticker = ticker;
    const cik = normCik(fields.cik);
    if (cik) out.cik = cik;
  } else if (type === "news") {
    const url = canonicalizeUrl(fields.url);
    if (url) out.url = url;
  } else if (type === "filing") {
    const accession = normAccession(fields.accession);
    if (accession) out.accession = accession;
    const url = canonicalizeUrl(fields.url);
    if (url) out.url = url;
  }
  return out;
}

function hardKeysMatch(a: HardKeys, b: HardKeys): boolean {
  return (
    (!!a.ticker && a.ticker === b.ticker) ||
    (!!a.cik && a.cik === b.cik) ||
    (!!a.url && a.url === b.url) ||
    (!!a.accession && a.accession === b.accession)
  );
}

function hardKeysConflict(a: HardKeys, b: HardKeys): boolean {
  return (
    (!!a.ticker && !!b.ticker && a.ticker !== b.ticker) ||
    (!!a.cik && !!b.cik && a.cik !== b.cik) ||
    (!!a.url && !!b.url && a.url !== b.url) ||
    (!!a.accession && !!b.accession && a.accession !== b.accession)
  );
}

/**
 * Find the best same-type duplicate of `fields` among `existing`. Returns the best record
 * and its verdict. An empty comparison key (no name/headline/statement) is never a duplicate
 * unless a hard key matches.
 */
export function findDuplicate<T extends DedupeCandidate>(
  existing: readonly T[],
  type: string,
  fields: Record<string, unknown>,
): DuplicateResult<T> {
  const incomingKeys = extractHardKeys(type, fields);

  // (1) Hard-key match — the strongest identity signal (same ticker/CIK/url/accession), even if
  // names differ. A ticker match makes "NVIDIA" and "NVIDIA Corp" the same node.
  for (const candidate of existing) {
    if (candidate.type !== type) continue;
    if (hardKeysMatch(incomingKeys, extractHardKeys(type, candidate.fields))) {
      return { best: candidate, verdict: "match", score: 100 };
    }
  }

  const key = comparisonKey(type, fields);
  if (!key) return { best: null, verdict: "none", score: 0 };

  // (2) Name fuzz — but a candidate that CONFLICTS on a hard key is a different identity and can
  // never be a duplicate, however similar the name. This is the fabricated-ticker-merge guard:
  // two companies with different tickers never merge, even with identical names.
  let best: T | null = null;
  let bestScore = 0;
  for (const candidate of existing) {
    if (candidate.type !== type) continue;
    if (hardKeysConflict(incomingKeys, extractHardKeys(type, candidate.fields))) continue;
    const score = fuzzyScore(key, comparisonKey(type, candidate.fields));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best === null) return { best: null, verdict: "none", score: 0 };
  const verdict = classify(bestScore);
  return verdict === "none" ? { best: null, verdict, score: bestScore } : { best, verdict, score: bestScore };
}
