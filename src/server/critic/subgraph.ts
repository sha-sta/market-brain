import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { slugify } from "@/server/normalize/assemble";
import { snippetOf } from "@/server/ask/prompt";
import type { EvidenceItem, JudgeInput } from "./thesis-prompt";

// Gather a thesis's evidence subgraph for the judge: the news/filing/catalyst/risk/signal/macro nodes
// that share an edge with the thesis or any name/theme it is "about". Recency-capped to bound the
// prompt (and cost). Returns the JudgeInput plus a map for verbatim-quote verification.

type Client = SupabaseClient<Database>;

const EVIDENCE_TYPES = ["news", "filing", "catalyst", "risk", "signal", "macro_factor"];
const MAX_EVIDENCE = 25;

/** [[id]] -> id, bare text -> slug. */
function linkId(s: string): string {
  const m = s.match(/^\[\[(.+)\]\]$/);
  return slugify((m ? m[1] : s).trim());
}

export interface ThesisSubgraph {
  input: JudgeInput;
  /** evidence id -> its snippet, so the judge's cited quotes can be verified verbatim before asserting. */
  evidenceById: Map<string, string>;
}

export async function gatherThesisEvidence(
  supabase: Client,
  graphId: string,
  thesis: { id: string; data: Record<string, unknown> },
): Promise<ThesisSubgraph> {
  const statement = typeof thesis.data.statement === "string" ? thesis.data.statement : "";
  const aboutRaw = Array.isArray(thesis.data.about) ? thesis.data.about : [];
  const about = aboutRaw.filter((x): x is string => typeof x === "string");
  const seedIds = [thesis.id, ...about.map(linkId)];

  // Neighbor ids: anything sharing an edge with the thesis or its about-targets (both directions).
  const [{ data: outE }, { data: inE }] = await Promise.all([
    supabase.from("edges").select("dst_id").eq("graph_id", graphId).in("src_id", seedIds),
    supabase.from("edges").select("src_id").eq("graph_id", graphId).in("dst_id", seedIds),
  ]);
  const neighborIds = new Set<string>();
  for (const e of outE ?? []) neighborIds.add(e.dst_id);
  for (const e of inE ?? []) neighborIds.add(e.src_id);
  for (const s of seedIds) neighborIds.delete(s);

  let evidence: EvidenceItem[] = [];
  if (neighborIds.size > 0) {
    const { data: nodes } = await supabase
      .from("nodes")
      .select("id, type, title, data, created_at")
      .eq("graph_id", graphId)
      .in("id", [...neighborIds])
      .in("type", EVIDENCE_TYPES)
      .in("lifecycle", ["active", "stale"]) // never judge against archived/superseded evidence
      .order("created_at", { ascending: false })
      .limit(MAX_EVIDENCE);
    evidence = (nodes ?? []).map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      const pub = typeof d.published_at === "string" ? d.published_at : typeof d.event_date === "string" ? d.event_date : null;
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        snippet: snippetOf(d),
        publishedAt: pub,
        sentiment: typeof d.sentiment === "string" ? d.sentiment : null,
        materiality: typeof d.materiality === "string" ? d.materiality : null,
      };
    });
  }

  const evidenceById = new Map(evidence.map((e) => [e.id, e.snippet]));
  return { input: { thesis: { id: thesis.id, statement, about }, evidence }, evidenceById };
}
