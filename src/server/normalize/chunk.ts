// Split a long document into overlapping chunks for per-chunk extraction. Pure. Deep research
// markdowns can exceed the extractor model's context; we split on paragraph boundaries first,
// hard-split any oversized paragraph on word boundaries (never mid-word), and prepend a small
// word-aligned overlap so an entity introduced at the end of one chunk and referenced at the
// start of the next isn't lost. Used by the normalize worker.

/** Last `overlap` chars of `s`, snapped forward to a word boundary (so it never starts mid-word). */
function overlapTail(s: string, overlap: number): string {
  if (overlap <= 0 || s.length <= overlap) return "";
  const tail = s.slice(s.length - overlap);
  const sp = tail.indexOf(" ");
  return sp >= 0 ? tail.slice(sp + 1).trim() : tail.trim();
}

/** Split a single over-long block into <= maxChars pieces on word boundaries. */
function splitOversized(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length > maxChars && cur) {
      out.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Split `text` into chunks each <= ~maxChars, joined on paragraph boundaries, with a word-aligned
 * `overlap`-char tail carried into the next chunk. Short text returns a single chunk; empty -> [].
 */
export function chunkText(text: string, maxChars = 8000, overlap = 400): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Atomic segments: paragraphs, with any oversized paragraph hard-split on words.
  const segments: string[] = [];
  for (const para of trimmed.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= maxChars) segments.push(p);
    else segments.push(...splitOversized(p, maxChars));
  }

  const chunks: string[] = [];
  let cur = "";
  for (const seg of segments) {
    const candidate = cur ? `${cur}\n\n${seg}` : seg;
    if (candidate.length > maxChars && cur) {
      chunks.push(cur);
      // Carry a word-aligned overlap into the next chunk, but never let it breach the budget
      // (each segment is already <= maxChars, so falling back to just the segment is always safe).
      const tail = overlapTail(cur, overlap);
      const withTail = tail ? `${tail}\n\n${seg}` : seg;
      cur = withTail.length <= maxChars ? withTail : seg;
    } else {
      cur = candidate;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
