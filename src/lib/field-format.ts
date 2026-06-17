// Pure helpers for rendering arbitrary node `data` fields in the node detail panel. Node data is
// free-form jsonb, so a field value can be a scalar, an array, or a plain object (e.g. person.links =
// Record<string,string>). String(object) -> "[object Object]"; these helpers let the panel render
// records as key/value rows and drop empty containers.

/** A plain object we can render as key/value rows (not an array, not null). */
export function isRenderableRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Empty for display purposes: null/undefined, an empty array, or an empty object. Falsy scalars
 *  (0, false, "") are NOT empty — they preserve the panel's prior behavior. */
export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isRenderableRecord(v)) return Object.keys(v).length === 0;
  return false;
}

/** Null-safe scalar coercion (null/undefined -> ""). */
export function formatScalar(v: unknown): string {
  return v == null ? "" : String(v);
}
