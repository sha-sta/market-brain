// Topic-tag normalization. Tags are lowercase kebab-case themes (e.g. "quantum-computing",
// "semiconductors") so the same topic never splits on case/spacing/punctuation. The extractor assigns
// raw tags; this collapses them to a canonical, deduped, capped set.

const MAX_TAGS = 6;

// Curated synonym map: variant kebab -> canonical kebab. Edit freely as drift shows up. Applied
// before AND after light singularization so "semis" -> "semiconductors" and "chips" -> "semiconductors".
// NOTE: alias VALUES are written in their post-singularization form (singular), because
// canonicalTag singularizes the LAST kebab segment. If a value were plural (e.g. "semiconductors"),
// the bare input "semiconductors" would singularize to "semiconductor" while the alias "semis" would
// not — splitting one topic into two tags. Keep values singular and they stay consistent.
export const TAG_ALIASES: Record<string, string> = {
  semis: "semiconductor",
  semi: "semiconductor",
  chips: "semiconductor",
  chip: "semiconductor",
  qc: "quantum-computing",
  quantum: "quantum-computing",
  "quantum-computer": "quantum-computing",
  ai: "artificial-intelligence",
  "a-i": "artificial-intelligence",
  ml: "machine-learning",
  dl: "deep-learning",
  llms: "llm",
  "large-language-model": "llm",
  "large-language-models": "llm",
  space: "aerospace",
  spacetech: "aerospace",
  "space-tech": "aerospace",
  defense: "defense-tech",
  defence: "defense-tech",
  ev: "electric-vehicle",
  evs: "electric-vehicle",
  crypto: "cryptocurrency",
  "data-center": "data-center",
  datacenter: "data-center",
  datacenters: "data-center",
};

/** A single raw tag -> canonical lowercase kebab (non-alphanumeric runs -> single dash, trimmed). */
export function normalizeTag(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Conservative plural -> singular on the LAST kebab segment only. Short words and Latin-ish
// singulars (bias, analysis, status, corpus) are left alone to avoid mangling them.
function singularizeWord(w: string): string {
  if (w.length <= 4) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`; // theories -> theory
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2); // boxes -> box, classes -> class
  if (/(ss|us|is|as|os|ous)$/.test(w)) return w; // bias, status, analysis, corpus, porous
  if (w.endsWith("s")) return w.slice(0, -1); // chips -> chip, movements -> movement
  return w;
}

function singularize(kebab: string): string {
  const parts = kebab.split("-");
  parts[parts.length - 1] = singularizeWord(parts[parts.length - 1]);
  return parts.join("-");
}

/** Collapse a kebab tag to its canonical form: alias lookup, then singularization, then alias again
 *  (so a plural alias key like "semis" is caught before, and a singularized form is aliased after). */
export function canonicalTag(kebab: string): string {
  if (TAG_ALIASES[kebab]) return TAG_ALIASES[kebab];
  const sing = singularize(kebab);
  return TAG_ALIASES[sing] ?? sing;
}

/** Normalize a list of tags: kebab + canonicalize each, drop empties/non-strings, dedupe, cap. */
export function normalizeTags(tags: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags ?? []) {
    if (typeof t !== "string") continue;
    const n = canonicalTag(normalizeTag(t));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
