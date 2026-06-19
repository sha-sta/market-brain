// The "living graph" lifecycle rules: which facts may be SUPERSEDED (swap old for new within a node),
// how a node's freshness "as of" is derived, and when stale news ARCHIVES. Pure (no IO) so it is
// unit-tested in isolation; the IO that applies these rules lives in upsert.ts (supersede on merge) and
// the daily engine (archival/prune). See supabase/migrations/0034-0038.

import type { NoteData } from "./types";
import { PERMANENCE_TIERS, type PermanenceTier } from "./schemas";

export type { PermanenceTier };

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

// Tiered decay: a chronological node's permanence `_tier` (assigned by the extractor) scales how long
// it stays before it ARCHIVES (soft-hide, recoverable) and then hard-DELETES (reclaims the row +
// embedding from the free-tier DB). `null` window => never. Structural types (company/person/sector/
// theme/product/commodity/organization/macro_factor/risk), `thesis`, and `note` are absent from the map
// => never auto-decay (theses are replaced via supersede; notes are the user's own writing). The SQL
// hard-delete (prune_archived_nodes) MUST mirror the deleteDays here — tests/unit/lifecycle.test.ts's
// sync-guard parses the migration and fails the build on drift.
export interface DecayWindow {
  archiveDays: number | null; // age past which an active node soft-hides (lifecycle='archived')
  deleteDays: number | null; // age past which an archived node is hard-deleted (reference-guarded, SQL)
}

const NEVER: DecayWindow = { archiveDays: null, deleteDays: null };

const DECAY: Record<string, Partial<Record<PermanenceTier, DecayWindow>>> = {
  news: {
    ephemeral: { archiveDays: 7, deleteDays: 21 },
    routine: { archiveDays: 21, deleteDays: 60 },
    notable: { archiveDays: 90, deleteDays: 270 },
    landmark: { archiveDays: 365, deleteDays: null }, // market-defining: hide late, never delete
  },
  catalyst: {
    ephemeral: { archiveDays: 14, deleteDays: 45 },
    routine: { archiveDays: 45, deleteDays: 120 },
    notable: { archiveDays: 120, deleteDays: 365 },
    landmark: NEVER, // a landmark catalyst IS the history — keep it
  },
  signal: {
    ephemeral: { archiveDays: 7, deleteDays: 21 },
    routine: { archiveDays: 30, deleteDays: 90 },
    notable: { archiveDays: 90, deleteDays: 270 },
    landmark: { archiveDays: 90, deleteDays: 270 }, // signals have no real "landmark"; treat as notable
  },
  filing: {
    // Filings are the primary record: archive late, NEVER hard-delete (no _tier emitted; uses the default).
    routine: { archiveDays: 180, deleteDays: null },
  },
};

// When `_tier` is missing/invalid, fall back to the LONGEST non-landmark tier for the type — "when unsure,
// keep longer" so a model omission never causes aggressive deletion.
const DEFAULT_TIER: Record<string, PermanenceTier> = {
  news: "notable",
  catalyst: "notable",
  signal: "notable",
  filing: "routine",
};

/** The node's permanence tier from `data._tier`, or null if absent/unrecognized. Pure. */
export function tierOf(data: NoteData): PermanenceTier | null {
  const t = data._tier;
  return typeof t === "string" && (PERMANENCE_TIERS as readonly string[]).includes(t) ? (t as PermanenceTier) : null;
}

/** The archive/delete windows for a node type at a given tier. Unknown types and `note`/`thesis`/
 *  structural types are never auto-decayed. A null tier falls back to the conservative DEFAULT_TIER. Pure. */
export function decayWindow(type: string, tier: PermanenceTier | null): DecayWindow {
  const byTier = DECAY[type];
  if (!byTier) return NEVER;
  const effective = tier ?? DEFAULT_TIER[type] ?? null;
  if (!effective) return NEVER;
  return byTier[effective] ?? NEVER;
}

/** Timestamp (ms) before which an ACTIVE node of this type/tier is eligible to archive, or null if it
 *  never archives. The IO caller compares the node's effective date (asOfFromData) against this. Pure. */
export function archiveCutoffMs(type: string, data: NoteData, nowMs: number): number | null {
  const { archiveDays } = decayWindow(type, tierOf(data));
  return archiveDays == null ? null : nowMs - archiveDays * DAY_MS;
}
