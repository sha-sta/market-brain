// The strict-critic strength rubric — the single source of truth shared by the thesis-judge prompt,
// the brief, and the thesis UI. Pure + unit-tested. The headline anti-sycophancy guarantee is
// enforceFloor(): a deterministic backstop that mechanically demotes an inflated rating the model
// can't justify with evidence, regardless of what label the model self-reported.

export const STRENGTH_LABELS = ["unsupported", "weak", "contested", "supported", "well-supported"] as const;
export type Strength = (typeof STRENGTH_LABELS)[number];

// Injected verbatim into the judge prompt AND shown in the UI legend, so the model and the reader
// calibrate to the same scale.
export const STRENGTH_RUBRIC: Record<Strength, string> = {
  unsupported: "No confirming evidence in the graph; or only the user's own assertion.",
  weak: "Thin/indirect confirming evidence; at least one unaddressed material bear-case point.",
  contested: "Real evidence on BOTH sides; confirming and challenging are roughly balanced.",
  supported: "Multiple independent confirming items; a bear-case exists but is addressable.",
  "well-supported": "Strong, corroborated, multi-source confirmation; the bear-case is weak or already known.",
};

const INDEX: Record<Strength, number> = {
  unsupported: 0,
  weak: 1,
  contested: 2,
  supported: 3,
  "well-supported": 4,
};

export function isStrength(s: string): s is Strength {
  return (STRENGTH_LABELS as readonly string[]).includes(s);
}

/** Clamp an LLM-reported label to the controlled vocab; anything unrecognized -> "weak" (conservative,
 *  never inflate). Case/space-insensitive. */
export function normalizeStrength(s: string): Strength {
  const norm = s.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return isStrength(norm) ? norm : "weak";
}

/** The HIGHEST label the evidence can justify: a rating needs real, net-positive confirming evidence to
 *  climb. 0 confirming -> "unsupported" (or "weak" if there's disconfirming to react to); when challenges
 *  match or outnumber confirms it can't exceed "contested"; 1 net confirm -> at most "supported"; 2+ ->
 *  may reach "well-supported". */
function maxLabelFor(confirmingCount: number, challengingCount: number): Strength {
  if (confirmingCount <= 0) return challengingCount > 0 ? "weak" : "unsupported";
  if (challengingCount >= confirmingCount) return "contested"; // can't claim net support when challenges tie/lead
  if (confirmingCount === 1) return "supported";
  return "well-supported";
}

/** Deterministic anti-sycophancy backstop. Demotes a rating the evidence can't support; NEVER inflates
 *  (a low self-rating with lots of evidence is left as the model chose). Apply before persisting. */
export function enforceFloor(label: Strength, confirmingCount: number, challengingCount: number): Strength {
  const cap = maxLabelFor(confirmingCount, challengingCount);
  return INDEX[label] <= INDEX[cap] ? label : cap;
}
