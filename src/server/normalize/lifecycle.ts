// The "living graph" lifecycle rules: which facts may be SUPERSEDED (swap old for new within a node),
// how a node's freshness "as of" is derived, and when stale news ARCHIVES. Pure (no IO) so it is
// unit-tested in isolation; the IO that applies these rules lives in upsert.ts (supersede on merge) and
// the daily engine (archival/prune). See supabase/migrations/0034-0038.

import type { NoteData } from "./types";

export type Lifecycle = "active" | "stale" | "archived" | "superseded";

// Identity / hard-key fields are NEVER superseded — a changed ticker/cik means a DIFFERENT entity, not
// an update (this protects the dedupe invariant in dedupe.ts). Merge may still FILL them when blank.
export const IDENTITY_FIELDS = new Set(["ticker", "cik", "accession", "url", "name"]);

// Qualitative narrative + state-enum fields whose value MAY be replaced when a newer source disagrees.
// Everything else (structural lists, links, websites, dates, units) is fill-only — never overwritten.
export const NARRATIVE_FIELDS = new Set([
  "summary",
  "description",
  "statement",
  "outcome",
  "current_reading",
  "mitigation",
  "transaction",
  "role",
  "sentiment",
  "materiality",
  "severity",
  "likelihood",
  "direction",
  "strength",
  "importance",
  "conviction",
]);

/** Should an existing field's value be OVERWRITTEN by the incoming one? Only narrative/enum fields, and
 *  only when the incoming source is strictly NEWER than the stored fact — an older backfill must never
 *  clobber a fresh value. Identity fields and undated incoming sources never supersede. Pure. */
export function decideSupersede(
  field: string,
  existingAsOfMs: number | null,
  incomingAsOfMs: number | null,
): boolean {
  if (IDENTITY_FIELDS.has(field)) return false;
  if (!NARRATIVE_FIELDS.has(field)) return false;
  if (incomingAsOfMs == null) return false; // no provenance on incoming -> never supersede
  if (existingAsOfMs == null) return true; // existing undated -> a dated incoming wins
  return incomingAsOfMs > existingAsOfMs;
}

const SOURCE_DATE_FIELDS = ["published_at", "filed_at", "event_date", "observed_at", "as_of"] as const;

/** Derive a node's "as of" timestamp (ms) from its source-dated fields, else the fallback (write time).
 *  This is what makes "newer wins" meaningful — a backfilled old article carries its real (old) date. */
export function asOfFromData(data: NoteData, fallbackMs: number): number {
  for (const key of SOURCE_DATE_FIELDS) {
    const v = data[key];
    if (typeof v === "string" && v) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return fallbackMs;
}

const DAY_MS = 86_400_000;
export const NEWS_ARCHIVE_DAYS = 45; // an unreferenced news node archives after this many days
export const NEWS_ARCHIVE_DAYS_HIGH = 120; // high-materiality news stays relevant (and shown) longer

/** A news node published before this cutoff is eligible to archive (if also unreferenced). Pure. */
export function newsArchiveCutoffMs(materiality: unknown, nowMs: number): number {
  const days = materiality === "high" ? NEWS_ARCHIVE_DAYS_HIGH : NEWS_ARCHIVE_DAYS;
  return nowMs - days * DAY_MS;
}
