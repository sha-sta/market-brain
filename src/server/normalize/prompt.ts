// Extraction prompt for the market knowledge graph. The system message + rules are the
// no-fabrication / no-advice guardrail. We send the prompt as two parts (static prefix + dynamic
// tail) so the large static prefix is Anthropic-prompt-cached across chunks (extract.ts) — do not
// fold the raw chunk or per-chunk hints into the prefix.

import { NODE_TYPES, type NodeType } from "./types";

export const SYSTEM =
  "You normalize messy financial notes and news into a typed market knowledge graph. " +
  "You output STRICT JSON only — no prose, no markdown fences. " +
  "Never invent facts: never fabricate prices, tickers, CIKs, accession numbers, dates, or financial " +
  "figures. Copy any ticker VERBATIM from the text; NEVER guess a ticker from a company name. If a " +
  "fact is unknown, leave the field empty. You ONLY aggregate and organize information — you NEVER " +
  "give buy/sell/hold advice, price targets, or recommendations of any kind. Keep frontmatter fields " +
  "short; put any longer prose in each note's `body`.";

type FieldKind = "str" | "int" | "float" | "bool" | "list" | "dict";

interface FieldSpec {
  name: string;
  kind: FieldKind;
  required?: boolean;
  link?: boolean; // value is a [[wikilink]] (or list of them)
  enum?: string[];
}

// Mirrors the type-specific fields in schemas.ts (managed BaseNote fields are excluded).
const FIELD_SPECS: Record<NodeType, FieldSpec[]> = {
  company: [
    { name: "name", kind: "str", required: true },
    { name: "ticker", kind: "str" }, // verbatim only
    { name: "exchange", kind: "str" },
    { name: "is_public", kind: "bool" },
    { name: "sector", kind: "str", link: true },
    { name: "themes", kind: "list", link: true },
    { name: "founders", kind: "list", link: true },
    { name: "cik", kind: "str" },
    { name: "status", kind: "str", enum: ["owned", "watchlist", "mentioned"] },
    { name: "manual_valuation", kind: "float" },
    { name: "website", kind: "str" },
    { name: "description", kind: "str" },
    { name: "links", kind: "dict" },
  ],
  person: [
    { name: "name", kind: "str", required: true },
    { name: "role", kind: "str" },
    { name: "company", kind: "str", link: true },
    { name: "status", kind: "str" },
    { name: "links", kind: "dict" },
  ],
  sector: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
  ],
  theme: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "related_themes", kind: "list", link: true },
  ],
  news: [
    { name: "headline", kind: "str", required: true },
    { name: "summary", kind: "str" },
    { name: "source", kind: "str" },
    { name: "url", kind: "str" },
    { name: "published_at", kind: "str" },
    { name: "sentiment", kind: "str", enum: ["bullish", "bearish", "neutral"] },
    { name: "materiality", kind: "str", enum: ["high", "med", "low"] },
    { name: "tickers", kind: "list" }, // raw ticker strings, verbatim
    { name: "_tier", kind: "str", enum: ["ephemeral", "routine", "notable", "landmark"] }, // permanence (see PERMANENCE TIER)
  ],
  filing: [
    { name: "form_type", kind: "str" },
    { name: "company", kind: "str", link: true },
    { name: "accession", kind: "str" },
    { name: "filed_at", kind: "str" },
    { name: "url", kind: "str" },
    { name: "summary", kind: "str" },
    { name: "insider", kind: "str", link: true },
    { name: "transaction", kind: "str" },
  ],
  thesis: [
    { name: "statement", kind: "str", required: true },
    { name: "about", kind: "list", link: true },
    { name: "conviction", kind: "str", enum: ["low", "medium", "high"] },
    { name: "confidence", kind: "float" },
    { name: "status", kind: "str", enum: ["active", "confirmed", "challenged", "closed"] },
  ],
  catalyst: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "event_date", kind: "str" }, // ISO date, verbatim
    { name: "about", kind: "list", link: true },
    { name: "importance", kind: "str", enum: ["high", "med", "low"] },
    { name: "outcome", kind: "str" },
    { name: "_tier", kind: "str", enum: ["ephemeral", "routine", "notable", "landmark"] }, // permanence (see PERMANENCE TIER)
  ],
  macro_factor: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "category", kind: "str", enum: ["rates", "inflation", "fx", "employment", "policy", "geopolitical", "commodity", "other"] },
    { name: "affects", kind: "list", link: true },
    { name: "current_reading", kind: "str" },
  ],
  risk: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "severity", kind: "str", enum: ["high", "med", "low"] },
    { name: "likelihood", kind: "str", enum: ["high", "med", "low"] },
    { name: "threatens", kind: "list", link: true },
    { name: "mitigation", kind: "str" },
  ],
  product: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "maker", kind: "str", link: true },
    { name: "category", kind: "str" },
    { name: "depends_on", kind: "list", link: true },
  ],
  commodity: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "unit", kind: "str" },
    { name: "used_in", kind: "list", link: true },
  ],
  organization: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "org_type", kind: "str", enum: ["regulator", "central_bank", "government", "standards_body", "exchange", "trade_body", "other"] },
    { name: "acts_on", kind: "list", link: true },
    { name: "website", kind: "str" },
  ],
  signal: [
    { name: "name", kind: "str", required: true },
    { name: "description", kind: "str" },
    { name: "signal_type", kind: "str" },
    { name: "direction", kind: "str", enum: ["bullish", "bearish", "neutral"] },
    { name: "strength", kind: "str", enum: ["strong", "moderate", "weak"] },
    { name: "observed_at", kind: "str" },
    { name: "about", kind: "list", link: true },
    { name: "supersedes", kind: "str", link: true },
    { name: "_tier", kind: "str", enum: ["ephemeral", "routine", "notable", "landmark"] }, // permanence (see PERMANENCE TIER)
  ],
  // `note` nodes are built by the worker (one per dumped doc), never emitted by the extractor —
  // buildTypeSpec excludes this type from the prompt. The empty spec satisfies the exhaustive Record.
  note: [],
};

function renderField(f: FieldSpec): string {
  const kind = f.enum ? `one of: ${f.enum.join("|")}` : f.kind;
  let s = `${f.name} [${kind}]`;
  if (f.required) s += " (required)";
  if (f.link) s += " (LINK [[id]])";
  return s;
}

/** Human-readable per-type field list for the prompt. `note` is excluded: it is a worker-only node
 *  type, never emitted by the extractor. */
export function buildTypeSpec(): string {
  return NODE_TYPES.filter((t) => t !== "note")
    .map((t) => `- ${t}: ${FIELD_SPECS[t].map(renderField).join("; ")}`)
    .join("\n");
}

// Guidance for the `_tier` permanence field on news/catalyst/signal. Each tier is tied to its REAL
// time-scale + a worked example so the model assigns it deliberately; the closing rule biases toward
// keeping a node LONGER when unsure, so the downstream hard-delete never over-prunes. Lives in the
// cache-stable prefix (identical every chunk).
export const TIER_GUIDANCE = `PERMANENCE TIER — set \`_tier\` on every news, catalyst, and signal note (how long it stays relevant):
- ephemeral (days): single-day price moves, routine intraday chatter, a one-off daily analyst note. e.g. "Stock dips 2% on light volume." -> ephemeral.
- routine (weeks): normal earnings prints, scheduled product launches, ordinary guidance updates. e.g. "Q3 revenue beat by 3%." -> routine.
- notable (months): sector-shifting developments, major contract wins, meaningful strategy changes. e.g. "Lands a multi-year cloud contract that reshapes its revenue mix." -> notable.
- landmark (permanent): acquisitions, CEO/founder changes, regulatory rulings, bankruptcies — facts that define a company's history. e.g. "Acquired for $40B." -> landmark.
WHEN UNSURE, choose the HIGHER tier (keep it longer). Never invent importance the text doesn't support.`;

/** The static, cache-stable head of the extraction prompt: rules + per-type field spec + worked
 *  example + relations vocab. Byte-identical for every chunk in a run, so the live extractor marks it
 *  as an Anthropic ephemeral cache breakpoint. MUST NOT contain the raw chunk, retry errors, or the
 *  existing-entity hints — those live in buildDynamicTail so the cache key stays stable. */
export function buildStaticPrefix(typeSpec: string): string {
  return `Extract entities from the raw financial note/article below into canonical, typed, LINKED notes.

Available note types and their fields (set EVERY field you have evidence for):
${typeSpec}

For each note:
- Put the entity's facts in \`frontmatter\` FIELDS, not in body — ticker, sector, published_at,
  sentiment, etc. each go in their field. \`body\` is only for leftover prose.
- Set a stable kebab-case \`id\` (lowercase, hyphens) for every note: "nvidia", "tsmc", "quantum-computing".
  Prefer the company's common name for the id, NOT its ticker.
- CONNECT related notes with [[id]] wikilinks in the linking fields, using the other note's exact
  \`id\`: a company's \`sector\` -> [[sector-id]], its \`themes\` -> [[theme-id]], its \`founders\` ->
  [[person-id]]; a person's \`company\` -> [[company-id]]; a thesis's \`about\` -> [[company-id]].
- TICKERS: copy a ticker ONLY if the text shows it, VERBATIM (e.g. "NVDA", "IONQ"). NEVER guess or
  derive a ticker from a company name. A private company (e.g. Anthropic, SpaceX) has NO ticker — set
  \`is_public\` false and leave \`ticker\` empty.
- Never fabricate prices, CIKs, accession numbers, or figures. Leave unknown fields empty.
- You are NOT an advisor. Never output buy/sell/hold language, price targets, or recommendations —
  only the facts the text states.
- For a \`news\` note: set \`headline\` (required), copy any article \`url\` and \`published_at\` date
  verbatim, list every \`tickers\` the article is about, and judge \`sentiment\`/\`materiality\` from
  the text only.
- Give each note 1-5 \`tags\`: lowercase topic THEMES (e.g. "quantum-computing", "semiconductors",
  "earnings"), not entity names. Never fabricate a theme that isn't in the text.
- Also return a top-level \`docNote\`: a short \`title\` (<= ~8 words, no trailing period), a 1-2
  sentence factual \`summary\` of the WHOLE input, and 1-5 topic \`tags\`. Grounded in the text — never invent.
- Also return a top-level \`relations\` array describing how the entities relate. Each item:
  {"subject":"<id>","relation":"<type>","object":"<id>","evidence":"<verbatim quote>"}.
  - \`relation\` is one of — STRONG (a verifiable claim): supplies_to, competes_with, subsidiary_of,
    founded_by, in_sector, in_theme, owns, listed_on, filed, insider_of, affects (macro_factor ->
    company/sector/theme), threatens (risk -> company/sector/thesis), exposed_to (company/sector ->
    risk/commodity/macro_factor), catalyst_for (catalyst -> company/sector/product), produces (company
    -> product), depends_on (product/company -> commodity/product), regulates (organization ->
    company/sector); or WEAK (association): mentions, relates_to, relevant_to, covers, co_occurs,
    acts_on (organization -> company/sector), supersedes (signal -> signal).
  - Use a STRONG relation ONLY when the text EXPLICITLY states it (e.g. "TSMC manufactures NVIDIA's
    chips", "Anthropic was founded by the Amodeis"). If two things are merely discussed together, use
    relates_to — do NOT infer a supply/ownership relationship from co-occurrence.
  - \`evidence\` MUST be a verbatim quote copied from the RAW NOTE that states the relationship.
    Never paraphrase, never invent — unsupported STRONG claims are discarded.
  - Evidence is checked by EXACT substring match. A paraphrase FAILS the check and the STRONG claim is
    DOWNGRADED to a weak association. Copy the note's wording exactly.

${TIER_GUIDANCE}

Worked example — for input "Jensen Huang, NVIDIA's (NVDA) CEO, said TSMC's CoWoS capacity constrains
H200 shipments. NVIDIA is the bellwether of the AI semiconductor theme.":
{
  "notes": [
    {"type":"company","id":"nvidia","title":"NVIDIA","frontmatter":{"name":"NVIDIA","ticker":"NVDA",
      "is_public":true,"sector":"[[semiconductors]]","themes":["[[artificial-intelligence]]"],
      "founders":["[[jensen-huang]]"]},"body":"","tags":["semiconductors","artificial-intelligence"]},
    {"type":"company","id":"tsmc","title":"TSMC","frontmatter":{"name":"TSMC"},"body":"","tags":["semiconductors"]},
    {"type":"person","id":"jensen-huang","title":"Jensen Huang","frontmatter":{"name":"Jensen Huang",
      "role":"CEO","company":"[[nvidia]]"},"body":"","tags":[]},
    {"type":"sector","id":"semiconductors","title":"Semiconductors","frontmatter":{"name":"Semiconductors"},"body":"","tags":[]}
  ],
  "ambiguous": [],
  "docNote": {"title":"NVIDIA CEO on TSMC capacity and H200","summary":"NVIDIA's CEO said TSMC CoWoS capacity constrains H200 shipments; NVIDIA leads the AI semiconductor theme.","tags":["semiconductors","artificial-intelligence"]},
  "relations": [
    {"subject":"tsmc","relation":"supplies_to","object":"nvidia","evidence":"TSMC's CoWoS capacity constrains H200 shipments"},
    {"subject":"jensen-huang","relation":"insider_of","object":"nvidia","evidence":"Jensen Huang, NVIDIA's (NVDA) CEO"}
  ]
}
Note how a tracked company's story (NVIDIA) organically pulls in an untracked supplier (TSMC) — that
is the point: the graph grows around what's discussed. NVIDIA's ticker "NVDA" was copied verbatim;
TSMC's ticker was left empty because the text did not give one.

Return JSON in exactly that shape: {"notes":[{type,id,title,frontmatter,body,tags}], "ambiguous":[...],
"docNote":{"title":"...","summary":"...","tags":[...]}, "relations":[{subject,relation,object,evidence}]}.`;
}

/** An entity already in the graph that the model may link to. Rendered into the dynamic tail (never
 *  the cached prefix), so injecting different neighbors per chunk never breaks the cache. */
export interface ExistingEntity {
  id: string;
  title: string;
  type: string;
}

function renderExistingEntities(entities: ExistingEntity[]): string {
  const lines = entities.map((e) => `- [[${e.id}]] (${e.type}) — ${e.title}`).join("\n");
  return `EXISTING ENTITIES (these already exist in the graph; link to one with its exact [[id]] ONLY when
this note refers to the same real thing — do NOT invent links, and do NOT assume two are the same
unless the text makes it clear):
${lines}`;
}

/** The dynamic, per-chunk tail of the extraction prompt: optional existing-entity link hints, the raw
 *  chunk, and the optional validation-retry block. Concatenated after the cached prefix. */
export function buildDynamicTail(
  rawText: string,
  opts: { errors?: string[]; existingEntities?: ExistingEntity[] } = {},
): string {
  const { errors, existingEntities } = opts;
  const blocks: string[] = [];
  if (existingEntities && existingEntities.length > 0) blocks.push(renderExistingEntities(existingEntities));
  blocks.push(`RAW NOTE:
'''
${rawText}
'''`);
  if (errors && errors.length > 0) {
    blocks.push(`Your previous output failed validation with these errors — fix them and return corrected JSON only:
${errors.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/** Full extraction user prompt = static prefix + dynamic tail. Kept for callers/tests that want the
 *  single string; the live extractor sends the two parts separately so the prefix is cached. */
export function buildPrompt(rawText: string, typeSpec: string, errors?: string[]): string {
  return `${buildStaticPrefix(typeSpec)}\n\n${buildDynamicTail(rawText, { errors })}`;
}
