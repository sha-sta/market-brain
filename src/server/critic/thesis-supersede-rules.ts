// Pure rules for thesis replacement (no IO, no server-only) so they unit-test in isolation. A new
// thesis SUPERSEDES an existing one when it is a near-restatement (high embedding similarity) about the
// same subject(s) — opinions are replaced, never time-decayed. The IO that detects + applies this lives
// in thesis-supersede.ts.

/** Auto-apply bar: theses about the same names are naturally similar, so we only auto-supersede on a
 *  NEAR-RESTATEMENT. Deliberately higher than the fact-correction bar — replacing a standing opinion is
 *  higher-stakes than overwriting a stored field. Below this, nothing happens (no silent replacement). */
export const SUPERSEDE_SIMILARITY = 0.92;

/** A new thesis replaces an old one only when both hold: same subject AND near-restatement. Pure. */
export function shouldSupersede(similarity: number, sharedSubject: boolean): boolean {
  return sharedSubject && similarity >= SUPERSEDE_SIMILARITY;
}

/** Bare ids from a thesis's `about` (strips [[ ]] wrapping) for subject-overlap comparison. Pure. */
export function aboutIds(data: Record<string, unknown>): Set<string> {
  const about = Array.isArray(data.about) ? data.about : [];
  return new Set(about.map((x) => String(x).replace(/^\[\[|\]\]$/g, "").trim()).filter(Boolean));
}

/** Do two theses share at least one `about` subject? Pure. */
export function sharesSubject(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const sb = aboutIds(b);
  for (const x of aboutIds(a)) if (sb.has(x)) return true;
  return false;
}
