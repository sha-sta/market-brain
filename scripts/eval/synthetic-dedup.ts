// Labeled adversarial entity pairs that STRESS the hard-key merge guard (dedupe.ts hardKeysConflict).
// Real large-cap news rarely proposes two same-named entities with conflicting tickers, so the natural
// corpus may block ~0 merges — that doesn't mean the guard is idle. These cases each have near-identical
// NAMES (fuzzy would merge them) but a CONFLICTING hard key (ticker / cik / accession) that must block
// the merge. Reported separately from the grounding %, never blended in.

/** A `blocked` case: guard ON must NOT merge (different identity); guard OFF (name fuzz only) WOULD merge
 *  — that averted merge is the fabricated-ticker failure mode. A `merged` case is a true duplicate
 *  (matching hard key) that must still merge with the guard on — proof the guard doesn't over-block. */
export interface SyntheticCase {
  label: string;
  type: string;
  existing: Record<string, unknown>;
  incoming: Record<string, unknown>;
  expect: "blocked" | "merged";
  note: string;
}

export const SYNTHETIC_DEDUP: SyntheticCase[] = [
  {
    label: "tesla-ticker-conflict",
    type: "company",
    existing: { name: "Tesla, Inc.", ticker: "TSLA" },
    incoming: { name: "Tesla Inc", ticker: "TSM" }, // TSM = Taiwan Semi — a wrong/fabricated ticker
    expect: "blocked",
    note: "Identical name, different ticker — must not merge Tesla into TSMC.",
  },
  {
    label: "apple-ticker-conflict",
    type: "company",
    existing: { name: "Apple Inc.", ticker: "AAPL" },
    incoming: { name: "Apple Inc", ticker: "APLE" }, // APLE = Apple Hospitality REIT (a real, different co)
    expect: "blocked",
    note: "Name collision with a different real ticker.",
  },
  {
    label: "nvidia-cik-conflict",
    type: "company",
    existing: { name: "NVIDIA Corporation", cik: "1045810" },
    incoming: { name: "NVIDIA Corporation", cik: "9999999" },
    expect: "blocked",
    note: "Same name, conflicting CIK — a fabricated CIK must not merge.",
  },
  {
    label: "filing-accession-conflict",
    type: "filing",
    existing: { form_type: "8-K", company: "NVDA", filed_at: "2025-05-28", accession: "0001045810-25-000111" },
    incoming: { form_type: "8-K", company: "NVDA", filed_at: "2025-05-28", accession: "0001045810-25-000222" },
    expect: "blocked",
    note: "Same form/company/date but distinct accession — two real filings, not one.",
  },
  {
    label: "xom-ticker-conflict",
    type: "company",
    existing: { name: "Exxon Mobil Corporation", ticker: "XOM" },
    incoming: { name: "Exxon Mobil Corporation", ticker: "XONE" }, // identical name, wrong ticker
    expect: "blocked",
    note: "Identical name, wrong ticker — fuzzy would auto-merge; the ticker conflict blocks it.",
  },
  {
    label: "amd-true-duplicate",
    type: "company",
    existing: { name: "Advanced Micro Devices", ticker: "AMD" },
    incoming: { name: "Advanced Micro Devices, Inc.", ticker: "AMD" },
    expect: "merged",
    note: "Control: matching ticker — the guard must STILL merge a true duplicate.",
  },
];
