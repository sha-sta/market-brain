import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WebSearchClient } from "@/server/market/websearch";
import type { WorkerDeps } from "@/server/normalize/worker";
import { drainPending } from "@/server/normalize/drain";
import { retrieveSources } from "@/server/ask/retrieve";
import { canonicalizeUrl } from "@/server/normalize/dedupe";
import { reportError } from "@/lib/observability";

// The gated research loop: web-search the prompt -> manufacture raw_uploads from the findings (the same
// reuse insight as the daily news fetch) -> drain them into grounded graph nodes via the UNCHANGED
// worker -> RAG-read the (now-richer) graph -> strict, sourced synthesis -> optionally promote surfaced
// names to tracked CANDIDATES. Fully injected (web/worker/synthesize) so it's integration-tested with
// stubs — no live API. Bounded by maxSearches/maxFetches (+ the per-day quota enforced at submit).

type Client = SupabaseClient<Database>;

export interface ResearchSynthInput {
  prompt: string;
  findings: Array<{ id: string; title: string; type: string; snippet: string }>;
}
export interface ResearchSynthOutput {
  summary: string; // sourced, non-advisory; cites [title](/node/id)
  trackNodeIds?: string[]; // surfaced names worth following (promoted to candidates)
}

export interface ResearchDeps {
  web: WebSearchClient;
  worker: WorkerDeps;
  synthesize: (input: ResearchSynthInput) => Promise<ResearchSynthOutput>;
  nowMs: number;
  maxSearches?: number;
  maxFetches?: number;
}

export interface ResearchJobRow {
  id: string;
  graph_id: string;
  requester: string;
  prompt: string;
}

export interface ResearchResult {
  summary: string;
  enqueued: number;
  nodesCreated: number;
  tracked: number;
}

const MAX_CANDIDATES = 5;

/** Run one research job end-to-end against the graph. Always returns a result; throws only on a hard
 *  DB failure (the caller marks the job failed). */
export async function runResearchJob(supabase: Client, job: ResearchJobRow, deps: ResearchDeps): Promise<ResearchResult> {
  const maxSearches = deps.maxSearches ?? 6;
  const maxFetches = deps.maxFetches ?? 10;

  // 1. Web search + manufacture raw_uploads (kind 'news') for findings we don't already have.
  const results = await deps.web.search(job.prompt, { numResults: maxSearches, withText: true });
  let enqueued = 0;
  const seen = new Set<string>();
  for (const r of results.slice(0, maxFetches)) {
    const url = canonicalizeUrl(r.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const { data: existing } = await supabase
      .from("raw_uploads")
      .select("id")
      .eq("graph_id", job.graph_id)
      .eq("source_ref", url)
      .maybeSingle();
    if (existing) continue; // idempotent across runs
    let text = r.text;
    if (!text) {
      const article = await deps.web.fetchArticle(r.url);
      text = article?.text ?? null;
    }
    if (!text) continue;
    const rawText = `HEADLINE: ${r.title}\nSOURCE: web\nURL: ${r.url}\nPUBLISHED: ${r.publishedAt ?? ""}\n\n${text}`;
    const { error } = await supabase
      .from("raw_uploads")
      .insert({ contributor: job.requester, graph_id: job.graph_id, kind: "news", source_ref: url, raw_text: rawText });
    if (error) {
      reportError(error, { scope: "researchJob.enqueue", job: job.id });
      continue;
    }
    enqueued += 1;
  }

  // 2. Drain the new findings into grounded nodes (reuse the worker).
  const drain = await drainPending(supabase, deps.worker);

  // 3. RAG-read the now-richer graph, then synthesize a strict, sourced answer.
  const sources = await retrieveSources(supabase, job.prompt, job.graph_id, { embed: deps.worker.embed }, 8);
  const synth = await deps.synthesize({
    prompt: job.prompt,
    findings: sources.map((s) => ({ id: s.id, title: s.title, type: s.type, snippet: s.snippet })),
  });

  // 4. Promote surfaced names to tracked CANDIDATES (not active — the cost firewall; admin/dad promotes).
  let tracked = 0;
  const validIds = new Set(sources.map((s) => s.id));
  for (const nodeId of (synth.trackNodeIds ?? []).filter((id) => validIds.has(id)).slice(0, MAX_CANDIDATES)) {
    const { error } = await supabase.from("tracked_entities").upsert(
      { graph_id: job.graph_id, node_id: nodeId, kind: "discovered", source: "auto", candidate_status: "candidate" },
      { onConflict: "graph_id,node_id", ignoreDuplicates: true },
    );
    if (!error) tracked += 1;
  }

  return { summary: synth.summary, enqueued, nodesCreated: drain.processed, tracked };
}
