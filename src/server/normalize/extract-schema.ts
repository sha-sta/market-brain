// The structured-output envelope for the extractor LLM (used by generateObject in extract.ts).
// Faithful to normalize.py's expected response shape. Validation/typing of each note's
// `frontmatter` happens afterwards via NODE_SCHEMAS — here we just enforce the envelope.

import { z } from "zod";

export const rawNoteSchema = z.object({
  type: z.string(),
  id: z.string().default(""),
  title: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).default({}),
  body: z.string().default(""),
  // Optional: older/stub envelopes omit it; assemble normalizes (and tolerates undefined).
  tags: z.array(z.string()).optional(),
});

// `docNote` carries the per-document summary + topic tags used to build the first-class note node.
// Optional at the envelope level (omitted by stubs / sparse model output); its inner fields default.
export const docNoteSchema = z.object({
  title: z.string().default(""), // a short (<= ~8 word) title for the document; worker falls back if blank
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
});

// A grounded relationship between two entities, each referenced by id. `evidence` is a verbatim
// quote from the source that states the relationship — the worker verifies it (substring check)
// before a STRONG relation is allowed to become an assertable fact. `relation` is validated against
// the controlled vocab in relations.ts (kept as a free string here so an off-vocab value doesn't
// reject the whole envelope; the worker normalizes it).
export const relationSchema = z.object({
  subject: z.string(),
  relation: z.string(),
  object: z.string(),
  evidence: z.string().default(""),
});

/** An array that DROPS items failing the item schema (and falls back to [] when the whole value is
 *  missing or not an array) instead of rejecting the ENTIRE envelope. A real LLM occasionally emits
 *  one malformed note/relation in an otherwise-good response; without this, that single bad item
 *  fail-hards the whole document (the cryptic multi-issue ZodError that lost an upload). Dropping the
 *  bad item is safe for integrity — a dropped relation is a missing edge, never a fabricated one, and
 *  surviving notes still pass strict per-field validation (NODE_SCHEMAS) in the worker. */
function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr): z.infer<T>[] =>
      arr.flatMap((x) => {
        const parsed = item.safeParse(x);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

export const extractEnvelopeSchema = z.object({
  notes: lenientArray(rawNoteSchema),
  ambiguous: z.array(z.string()).catch([]),
  // A malformed docNote becomes undefined (the worker falls back to a title from the note text).
  docNote: docNoteSchema.optional().catch(undefined),
  // Optional (stubs/sparse output omit it; the worker treats undefined as []); lenient when present.
  relations: lenientArray(relationSchema).optional(),
});

export type RawNote = z.infer<typeof rawNoteSchema>;
export type RawRelation = z.infer<typeof relationSchema>;
export type ExtractEnvelope = z.infer<typeof extractEnvelopeSchema>;
