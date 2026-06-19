// Assemble a validated extractor note into a canonical NodeRecord: generate a stable kebab id, lift
// status/managed fields, stash body in data.

import { MANAGED_FIELDS, type NodeRecord, type NodeType, type NoteData } from "./types";
import { normalizeTags } from "./tags";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Title -> stable kebab id. Non-alphanumeric runs become single dashes. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "node";
}

/** Make `base` unique against `taken`, appending -2, -3, ... on collision. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Per-type default status. A company starts `mentioned` (it becomes owned/watchlist via the
 *  tracked_entities table, never the graph); a catalyst starts `pending` (it resolves to occurred);
 *  everything else (thesis, macro_factor, risk, product, commodity, organization, signal, …) is `active`. */
export function defaultStatus(type: string): string {
  switch (type) {
    case "company":
      return "mentioned";
    case "catalyst":
      return "pending";
    default:
      return "active";
  }
}

export interface ExtractedNote {
  type: NodeType;
  id?: string;
  title: string;
  data: Record<string, unknown>; // validated frontmatter (NODE_SCHEMAS output)
  body?: string;
  tags?: string[]; // LLM-assigned topic tags (normalized at assembly)
}

/**
 * Build a NodeRecord. Adds the resolved id to `taken` so a batch never collides with itself.
 */
export function assemble(note: ExtractedNote, taken: Set<string>): NodeRecord {
  const base = note.id && KEBAB.test(note.id) ? note.id : slugify(note.title);
  const id = uniqueId(base, taken);
  taken.add(id);

  const data: NoteData = { ...note.data };
  const status =
    typeof data.status === "string" && data.status ? data.status : defaultStatus(note.type);

  // Lift status to the top-level column; drop any managed fields that leaked into frontmatter.
  delete data.status;
  for (const k of MANAGED_FIELDS) delete data[k];

  const body = (note.body ?? "").trim();
  if (body) data.body = body;

  return {
    id,
    type: note.type,
    title: note.title,
    status,
    tags: normalizeTags(note.tags),
    relatesTo: [],
    source: "upload",
    data,
  };
}
