// Zod schemas for the 15 market node types. These validate the type-specific `frontmatter` the
// extractor returns (which becomes nodes.data). BaseNote scaffolding (id/type/title/created/updated/
// source) and the top-level `status` column are handled by the pipeline, not here. Unknown keys are
// stripped (zod default), so a `status` the LLM puts in frontmatter is lifted/defaulted by assemble.

import { z } from "zod";
import { NODE_TYPES, type NodeType } from "./types";

/** null/undefined -> default `d`, otherwise pass through to `schema`. */
function def<T extends z.ZodTypeAny>(schema: T, d: unknown) {
  return z.preprocess((v) => (v == null ? d : v), schema);
}

/** A list field that tolerates null/omitted by coercing to []. */
function strList() {
  return def(z.array(z.string()), []);
}

const optStr = z.string().nullish();

// Permanence tier for CHRONOLOGICAL nodes (news/catalyst/signal): how long the node stays relevant
// before it decays. Assigned by the extractor (prompt.ts) with explicit time-scale guidance. A bogus
// or omitted value coerces to undefined (NOT a throw) so the decay engine applies its conservative
// "keep longer" default rather than over-deleting. The canonical vocabulary lives here, reused by
// lifecycle.ts's decayWindow().
export const PERMANENCE_TIERS = ["ephemeral", "routine", "notable", "landmark"] as const;
export type PermanenceTier = (typeof PERMANENCE_TIERS)[number];
const tierField = z.enum(PERMANENCE_TIERS).nullish().catch(undefined);

// public OR private. `ticker` is identity for public cos (copied verbatim, NEVER guessed); `name` is
// identity for private cos (Anthropic, SpaceX) which have no ticker/quote API. `manual_valuation`
// carries a private company's worth. sector/themes/founders are [[wikilinks]].
const company = z.object({
  name: z.string().min(1),
  ticker: optStr, // verbatim or empty — never fabricated
  exchange: optStr,
  is_public: def(z.boolean(), true),
  sector: optStr, // [[sector-id]]
  themes: strList(), // [[theme-id]]...
  founders: strList(), // [[person-id]]...
  cik: optStr, // SEC central index key (digits) — verbatim or empty
  status: def(z.enum(["owned", "watchlist", "mentioned"]), "mentioned"),
  manual_valuation: z.coerce.number().nullish(),
  website: optStr,
  description: optStr,
  links: def(z.record(z.string(), z.string()), {}),
});

const person = z.object({
  name: z.string().min(1),
  role: optStr, // CEO, CFO, founder, analyst, ...
  company: optStr, // [[company-id]]
  status: def(z.string(), "mentioned"),
  links: def(z.record(z.string(), z.string()), {}),
});

const sector = z.object({
  name: z.string().min(1),
  description: optStr,
});

const theme = z.object({
  name: z.string().min(1),
  description: optStr,
  related_themes: strList(), // [[theme-id]]...
});

const news = z.object({
  headline: z.string().min(1),
  summary: optStr,
  source: optStr,
  url: optStr, // canonicalized into the dedupe hard key
  published_at: optStr, // ISO date/datetime, verbatim
  sentiment: def(z.enum(["bullish", "bearish", "neutral"]), "neutral"),
  materiality: def(z.enum(["high", "med", "low"]), "med"),
  tickers: strList(), // raw ticker strings -> resolved to company `mentions` edges deterministically
  _tier: tierField, // permanence tier -> drives decay window (lifecycle.ts)
});

const filing = z.object({
  form_type: optStr, // 8-K, 10-Q, Form 4, ...
  company: optStr, // [[company-id]]
  accession: optStr, // SEC accession (hard key) — verbatim
  filed_at: optStr,
  url: optStr,
  summary: optStr,
  insider: optStr, // [[person-id]] (Form 4)
  transaction: optStr, // free text describing the insider transaction
});

// The user's own investment thesis, as a node so it embeds + collects confirm/challenge edges.
const thesis = z.object({
  statement: z.string().min(1),
  about: strList(), // [[company-id|theme-id]]...
  conviction: def(z.enum(["low", "medium", "high"]), "medium"),
  confidence: def(z.coerce.number().min(0).max(1), 0.5),
  status: def(z.enum(["active", "confirmed", "challenged", "closed"]), "active"),
});

// A discrete, dated event that can move an entity. Lifecycle via the top-level status (pending -> occurred).
const catalyst = z.object({
  name: z.string().min(1),
  description: optStr,
  event_date: optStr, // ISO date the catalyst is expected/occurred — verbatim
  about: strList(), // [[company|sector|theme|product]] it bears on
  importance: def(z.enum(["high", "med", "low"]), "med"),
  outcome: optStr, // filled once resolved (a supersede target)
  _tier: tierField, // permanence tier -> drives decay window (lifecycle.ts)
});

// A market-wide driver (rates, inflation, FX, oil regime). Persistent backdrop.
const macro_factor = z.object({
  name: z.string().min(1),
  description: optStr,
  category: def(z.enum(["rates", "inflation", "fx", "employment", "policy", "geopolitical", "commodity", "other"]), "other"),
  affects: strList(), // [[company|sector|theme]]
  current_reading: optStr, // latest qualitative reading (a supersede target)
});

// A threat to an entity's thesis/value. Lifecycle active -> mitigated.
const risk = z.object({
  name: z.string().min(1),
  description: optStr,
  severity: def(z.enum(["high", "med", "low"]), "med"),
  likelihood: def(z.enum(["high", "med", "low"]), "med"),
  threatens: strList(), // [[company|sector|theme|thesis]]
  mitigation: optStr, // a supersede target
});

// A product/service line that is itself a tracked thing (H200, Ozempic, iPhone).
const product = z.object({
  name: z.string().min(1),
  description: optStr,
  maker: optStr, // [[company]] that produces it
  category: optStr,
  depends_on: strList(), // [[commodity|product|company]]
});

// A raw material / critical input (lithium, HBM, neon gas, crude).
const commodity = z.object({
  name: z.string().min(1),
  description: optStr,
  unit: optStr, // e.g. "per tonne", "per barrel"
  used_in: strList(), // [[product|sector|company]]
});

// A non-company organization: regulator, central bank, standards body, government, index provider.
const organization = z.object({
  name: z.string().min(1),
  description: optStr,
  org_type: def(z.enum(["regulator", "central_bank", "government", "standards_body", "exchange", "trade_body", "other"]), "other"),
  acts_on: strList(), // [[company|sector|theme|commodity]]
  website: optStr,
});

// A derived/observed indicator that can supersede a prior reading (technical/quant/insider signal).
const signal = z.object({
  name: z.string().min(1),
  description: optStr,
  signal_type: optStr, // e.g. "valuation", "momentum", "insider-buying"
  direction: def(z.enum(["bullish", "bearish", "neutral"]), "neutral"),
  strength: def(z.enum(["strong", "moderate", "weak"]), "moderate"),
  observed_at: optStr,
  about: strList(), // [[company|sector|theme]]
  supersedes: optStr, // [[signal-id]] this one replaces (drives the signal supersession edge)
  _tier: tierField, // permanence tier -> drives decay window (lifecycle.ts)
});

// `note` data is populated by the worker (full markdown body + LLM summary), not by the extractor,
// so every field is optional — validateNoteData("note", …) must succeed on a worker-built note.
const note = z.object({
  summary: optStr,
  body: optStr,
});

export const NODE_SCHEMAS: Record<NodeType, z.ZodType> = {
  company,
  person,
  sector,
  theme,
  news,
  filing,
  thesis,
  catalyst,
  macro_factor,
  risk,
  product,
  commodity,
  organization,
  signal,
  note,
};

export type ValidateResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

/** Validate a note's frontmatter against its type schema. Unknown types fail. */
export function validateNoteData(type: string, data: unknown): ValidateResult {
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    return { success: false, error: `unknown node type '${type}'` };
  }
  const schema = NODE_SCHEMAS[type as NodeType];
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: z.prettifyError(parsed.error) };
  }
  return { success: true, data: parsed.data as Record<string, unknown> };
}
