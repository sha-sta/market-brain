import { createHash } from "node:crypto";

// The per-document note node's id. Derived from (contributor + raw content) rather than the
// raw_uploads row id, so re-UPLOADING the same document (a new row) reuses the same note node instead
// of minting a duplicate — while re-dumping still re-runs extraction (upgrading grounded edges). Two
// genuinely different dumps, or the same text by different contributors, stay distinct.
export function noteIdFor(contributor: string | null, rawText: string): string {
  const hash = createHash("sha256")
    .update(`${contributor ?? "anon"}\n${rawText}`)
    .digest("hex")
    .slice(0, 16);
  return `note-${hash}`;
}
