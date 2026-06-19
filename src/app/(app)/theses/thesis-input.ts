// Pure helpers for the add-thesis form (no "use server", so they unit-test and can be imported by the
// server action). A thesis is added by piping formatted text through the SAME dump/normalize pipeline
// every other node uses (uploadText -> raw_uploads -> drain -> extractor -> a `thesis` node), not a
// bespoke insert — so dump-based thesis extraction stays the one code path.

export type ThesisInput = { ok: true; statement: string } | { ok: false; message: string };

/** Validate the user's thesis text. Returns a user-facing {ok,message} (never throws) so the action
 *  can surface it inline. */
export function validateThesisStatement(raw: string): ThesisInput {
  const statement = raw.trim();
  if (!statement) return { ok: false, message: "Write your thesis first." };
  if (statement.length > 2000) return { ok: false, message: "Keep your thesis under 2,000 characters." };
  return { ok: true, statement };
}

/** Format the thesis (and optional [[about]] subjects) into a raw dump the extractor reads as a thesis
 *  node. The THESIS:/ABOUT: framing matches the extractor's statement/about fields. */
export function formatThesisDump(statement: string, about: string): string {
  const lines = [`THESIS: ${statement.trim()}`];
  const subjects = about.trim();
  if (subjects) lines.push(`ABOUT: ${subjects}`);
  return lines.join("\n");
}
