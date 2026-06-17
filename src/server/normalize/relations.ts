// Relation vocabulary + the grounding rules that decide whether an edge may assert a fact.
// STRONG relations make a verifiable claim and, with a verbatim evidence quote + enough confidence,
// become `assertable`. WEAK relations are association/navigation/provenance only and never ground a
// generated claim. There is deliberately NO buy/sell/recommends relation — the model cannot express
// investment advice. STRONG_RELATIONS MUST stay in sync with the `assertable` generated column in
// supabase/migrations/0025_finance_assertable.sql.

export const STRONG_RELATIONS = [
  "owns", // a holder owns a company (a position-as-fact; the portfolio table is the source of truth)
  "in_sector", // company -> sector
  "in_theme", // company -> theme
  "founded_by", // company -> person
  "subsidiary_of", // company -> parent company
  "supplies_to", // company -> customer company
  "competes_with", // company <-> company
  "listed_on", // company -> exchange
  "filed", // company -> filing
  "insider_of", // person -> company
] as const;

export const WEAK_RELATIONS = [
  "mentions", // provenance: a note/news/filing mentions an entity
  "relevant_to", // semantic relevance (news -> holding, thesis -> company/theme)
  "covers", // a theme/sector covers a company
  "confirms_thesis", // news -> thesis (created by the thesis judge, never the extractor)
  "challenges_thesis", // news -> thesis (created by the thesis judge)
  "co_occurs", // two entities surfaced together
  "relates_to", // generic association / downgrade target
] as const;

export type Relation = (typeof STRONG_RELATIONS)[number] | (typeof WEAK_RELATIONS)[number];

const STRONG = new Set<string>(STRONG_RELATIONS);
const ALL = new Set<string>([...STRONG_RELATIONS, ...WEAK_RELATIONS]);

export const ASSERTABLE_CONFIDENCE = 0.8; // mirrors the generated-column threshold
export const CONFIDENCE_GROUNDED = 0.9; // strong relation, evidence verified in the source
export const CONFIDENCE_WEAK = 0.6; // weak relation (or provenance)
export const CONFIDENCE_WIKILINK = 0.4; // structural edge from a [[wikilink]] field
const DOWNGRADE_CONFIDENCE = 0.3; // strong claim whose evidence did not verify

export function isStrong(relation: string): boolean {
  return STRONG.has(relation);
}

export function isKnownRelation(relation: string): boolean {
  return ALL.has(relation);
}

/** Normalize an LLM-emitted relation to the controlled vocab; unknown -> weak `relates_to`. */
export function normalizeRelation(relation: string): string {
  const r = relation.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALL.has(r) ? r : "relates_to";
}

// Maps a wikilink FIELD name to its relation_type for structural edges. These have no evidence, so
// even a STRONG mapping (e.g. founders->founded_by) is NOT assertable until a grounded relation with a
// verbatim quote corroborates it. `tickers` is NOT here: it is a list of raw ticker STRINGS (not
// [[wikilinks]]), so the cron resolves it to company nodes by ticker hard-key and writes the
// `mentions` edge deterministically — see src/server/market/daily.ts.
const FIELD_RELATION: Record<string, string> = {
  sector: "in_sector",
  themes: "in_theme",
  theme: "in_theme",
  founders: "founded_by",
  company: "relevant_to", // person/filing -> company (navigational, never asserted from a wikilink)
  // NOTE: filing.insider = [[person]] is intentionally NOT mapped to insider_of. insider_of means
  // person -> company; a structural filing -> person wikilink would carry the wrong endpoints AND
  // direction, so it falls through to weak relates_to (navigational). The correct, direction-controlled
  // insider_of edge comes only from the extractor's grounded `relations` array.
  about: "relevant_to", // thesis -> company/theme
  related_themes: "relates_to",
  covers: "covers",
  relates_to: "relates_to",
};

export function fieldToRelation(field: string): string {
  return FIELD_RELATION[field] ?? "relates_to";
}

/** A quote shorter than this (after normalization) can't actually evidence a relationship — a 2-3
 *  char token like "at"/"is" is noise, not proof — so it never verifies. */
const MIN_QUOTE_LEN = 4;

/** Verbatim-evidence check: the quote must appear in the source text. Both sides are Unicode-NFC
 *  normalized (so composed vs decomposed accents compare equal), lowercased, and whitespace-collapsed.
 *  Empty/too-short quote -> false. This deterministic guard is what blocks fabricated factual edges. */
export function verifyEvidence(quote: string | null | undefined, sourceText: string): boolean {
  if (!quote) return false;
  const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const q = norm(quote);
  if (q.length < MIN_QUOTE_LEN) return false;
  return norm(sourceText).includes(q);
}

/** Mirror of the DB `assertable` generated column, for pure tests + pre-insert reasoning. */
export function isAssertable(edge: {
  relation_type: string;
  confidence: number;
  evidence_quote?: string | null;
}): boolean {
  return isStrong(edge.relation_type) && edge.confidence >= ASSERTABLE_CONFIDENCE && Boolean(edge.evidence_quote);
}

export interface GroundedEdge {
  relation_type: string;
  confidence: number;
  evidence_quote: string | null;
  method: string;
}

/** Resolve a grounded LLM relation into the edge metadata to persist. A STRONG claim whose evidence
 *  is NOT found in the source is downgraded to a weak `relates_to` (kept for navigation, never
 *  assertable) rather than minting a false fact. */
export function resolveGroundedEdge(relation: string, evidence: string, sourceText: string): GroundedEdge {
  const rel = normalizeRelation(relation);
  const verified = verifyEvidence(evidence, sourceText);
  if (isStrong(rel)) {
    if (verified) {
      return { relation_type: rel, confidence: CONFIDENCE_GROUNDED, evidence_quote: evidence, method: "llm_extract" };
    }
    // Unsupported strong claim: downgrade to association, drop the (unverified) quote.
    return { relation_type: "relates_to", confidence: DOWNGRADE_CONFIDENCE, evidence_quote: null, method: "llm_unverified" };
  }
  // Weak relation: keep the quote only if it verified (informative); never assertable regardless.
  return { relation_type: rel, confidence: CONFIDENCE_WEAK, evidence_quote: verified ? evidence : null, method: "llm_extract" };
}
