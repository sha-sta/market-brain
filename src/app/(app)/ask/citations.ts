// Pure citation parsing for the /ask answer stream. The model is told to cite as [title](/node/id),
// but it can emit an id that was NOT in the retrieved set (a hallucinated link). We only linkify
// citations whose id is in the retrieved set; an unknown id renders as plain text (its title), so a
// reader never clicks through to a node the answer wasn't grounded in.

const CITATION = /\[([^\]]+)\]\(\/node\/([^)]+)\)/g;

export type Segment = { kind: "text"; value: string } | { kind: "cite"; id: string; title: string };

export function segmentAnswer(text: string, validIds: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", value: text.slice(last, idx) });
    const [, title, id] = m;
    if (validIds.has(id)) out.push({ kind: "cite", id, title });
    else out.push({ kind: "text", value: title }); // unknown id -> plain text, no link
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
