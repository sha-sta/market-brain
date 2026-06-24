// Conservative merge — faithful port of normalize.py `_merge`. When an incoming entity is a confident
// duplicate of an existing node, we GROW the existing node: fill empty scalars, union list fields, and
// never clobber a value that's already there. OPTIONAL supersede mode (pass `supersede`) additionally
// SWAPS a narrative field's value when the incoming source is newer (the living-graph "old for new"
// rule, decideSupersede in lifecycle.ts) — identity fields are never touched. Without `supersede` the
// behavior is byte-identical to the original fill-only merge.

import type { NodeRecord, NoteData } from "./types";
import { decideSupersede } from "./lifecycle";

// Fields that should never be fill-merged here (none currently).
const SKIP_FIELDS = new Set<string>();

/** Empty = nothing worth keeping. Falsy scalars (''/0/false) are fillable, per Python truthiness. */
function isEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return !v;
}

/** Union of two lists: existing order first, then new items, deduped by value. */
function unionList(a: unknown[], b: unknown[]): { result: unknown[]; changed: boolean } {
  const seen = new Set(a.map((x) => JSON.stringify(x)));
  const result = [...a];
  let changed = false;
  for (const item of b) {
    const k = JSON.stringify(item);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(item);
      changed = true;
    }
  }
  return { result, changed };
}

/** When merging, swap a narrative field for a newer source's value (decideSupersede). Both timestamps
 *  are ms; null means undated. Omit to get the original fill-only merge. */
export interface SupersedeContext {
  existingAsOfMs: number | null;
  incomingAsOfMs: number | null;
}

/** Merge `incoming` into a copy of `existing`. Returns the new record, whether it changed, and the
 *  list of fields that were SUPERSEDED (overwritten because the incoming source was newer) — empty
 *  unless `supersede` is supplied. */
export function mergeNode(
  existing: NodeRecord,
  incoming: NodeRecord,
  supersede?: SupersedeContext,
): { merged: NodeRecord; changed: boolean; superseded: string[] } {
  let changed = false;
  const superseded: string[] = [];
  const data: NoteData = { ...existing.data };

  for (const [key, incomingVal] of Object.entries(incoming.data)) {
    if (SKIP_FIELDS.has(key)) continue;
    const existingVal = data[key];

    if (Array.isArray(existingVal) || Array.isArray(incomingVal)) {
      const a = Array.isArray(existingVal) ? existingVal : [];
      const b = Array.isArray(incomingVal) ? incomingVal : [];
      const { result, changed: listChanged } = unionList(a, b);
      if (listChanged) {
        data[key] = result;
        changed = true;
      }
      continue;
    }

    // Scalar: fill when existing is empty and incoming has something.
    if (isEmpty(existingVal) && !isEmpty(incomingVal)) {
      data[key] = incomingVal;
      changed = true;
      continue;
    }

    // Supersede: a newer source replaces a narrative field that already had a (different) value.
    if (
      supersede &&
      !isEmpty(incomingVal) &&
      !isEmpty(existingVal) &&
      JSON.stringify(existingVal) !== JSON.stringify(incomingVal) &&
      decideSupersede(key, supersede.existingAsOfMs, supersede.incomingAsOfMs)
    ) {
      data[key] = incomingVal;
      changed = true;
      superseded.push(key);
    }
  }

  const tags = unionList(existing.tags, incoming.tags);
  const relatesTo = unionList(existing.relatesTo, incoming.relatesTo);
  if (tags.changed) changed = true;
  if (relatesTo.changed) changed = true;

  const merged: NodeRecord = {
    ...existing,
    data,
    tags: tags.result as string[],
    relatesTo: relatesTo.result as string[],
  };
  return { merged, changed, superseded };
}
