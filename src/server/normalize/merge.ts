// Conservative merge — faithful port of normalize.py `_merge`. When an incoming entity is a
// confident duplicate of an existing node, we GROW the existing node rather than replacing it:
// fill empty scalars, union list fields, and never clobber a value that's already there.

import type { NodeRecord, NoteData } from "./types";

// Append-only logs are owned by the outreach pipeline, not the normalizer — never merged here.
const SKIP_FIELDS = new Set(["messages", "outreach_log"]);

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

/** Merge `incoming` into a copy of `existing`. Returns the new record + whether it changed. */
export function mergeNode(
  existing: NodeRecord,
  incoming: NodeRecord,
): { merged: NodeRecord; changed: boolean } {
  let changed = false;
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

    // Scalar: only fill when existing is empty and incoming has something.
    if (isEmpty(existingVal) && !isEmpty(incomingVal)) {
      data[key] = incomingVal;
      changed = true;
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
  return { merged, changed };
}
