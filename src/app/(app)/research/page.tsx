import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ResearchBox, type ResearchJobView } from "./research-box";

// Ask the brain to go research something: it web-searches, populates the graph with what it finds, and
// writes back a strict, sourced synthesis (with a bear case). Gated by a daily quota. requireActive
// bounces guests/pending users.
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("research_jobs")
    .select("id, prompt, status, result_summary")
    .eq("graph_id", graphId)
    .order("created_at", { ascending: false })
    .limit(15);
  const initial: ResearchJobView[] = (rows ?? []).map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status,
    result: r.result_summary,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Research</h1>
      <p className="mb-6 text-sm text-muted">
        Ask the brain to dig into a name, industry, or connection. It searches the web, folds what it finds
        into your graph, and writes back a sourced read with the bear case — it never recommends a trade.
      </p>
      <ResearchBox initial={initial} />
    </div>
  );
}
