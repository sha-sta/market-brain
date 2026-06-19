import Link from "next/link";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ThesisVerdict, type VerdictEvidence } from "@/components/thesis-verdict";
import { AddThesisForm } from "./add-thesis-form";

// The thesis management surface: your standing opinions, each with the strict critic's verdict (reusing
// the same panel the node page shows). Add a new one (piped through the dump pipeline); replaced ones
// move to a collapsed "Replaced" section pointing at their successor. Theses are never time-decayed.
export const dynamic = "force-dynamic";

type Row = { id: string; title: string; data: Record<string, unknown>; superseded_by: string | null };

export default async function ThesesPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const { data: liveRows } = await supabase
    .from("nodes")
    .select("id, title, data, superseded_by")
    .eq("graph_id", graphId)
    .eq("type", "thesis")
    .in("lifecycle", ["active", "stale"])
    .order("updated_at", { ascending: false });
  const live = (liveRows ?? []) as Row[];

  // Confirm/challenge evidence edges for the verdict panels (one batched query for all live theses).
  const thesisIds = live.map((t) => t.id);
  const confirming = new Map<string, VerdictEvidence[]>();
  const challenging = new Map<string, VerdictEvidence[]>();
  if (thesisIds.length > 0) {
    const { data: edges } = await supabase
      .from("edges")
      .select("src_id, dst_id, relation_type, evidence_quote")
      .eq("graph_id", graphId)
      .in("dst_id", thesisIds)
      .in("relation_type", ["confirms_thesis", "challenges_thesis"]);
    const evidenceIds = [...new Set((edges ?? []).map((e) => e.src_id))];
    const { data: evNodes } = evidenceIds.length
      ? await supabase.from("nodes").select("id, title").eq("graph_id", graphId).in("id", evidenceIds)
      : { data: [] };
    const titleById = new Map((evNodes ?? []).map((n) => [n.id, n.title]));
    for (const e of edges ?? []) {
      const item: VerdictEvidence = { id: e.src_id, title: titleById.get(e.src_id) ?? e.src_id, quote: e.evidence_quote };
      const bucket = e.relation_type === "confirms_thesis" ? confirming : challenging;
      bucket.set(e.dst_id, [...(bucket.get(e.dst_id) ?? []), item]);
    }
  }

  const { data: supersededRows } = await supabase
    .from("nodes")
    .select("id, title, superseded_by")
    .eq("graph_id", graphId)
    .eq("type", "thesis")
    .eq("lifecycle", "superseded")
    .order("updated_at", { ascending: false });
  const superseded = supersededRows ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Theses</h1>
      <p className="mb-6 text-sm text-muted">
        Your standing views. The strict critic stress-tests each against the graph&apos;s evidence — it
        never flatters. Theses don&apos;t age out; replace one by writing a new view on the same name.
      </p>

      <div className="mb-8">
        <AddThesisForm />
      </div>

      {live.length === 0 ? (
        <p className="text-sm text-muted">No theses yet. Write your first one above.</p>
      ) : (
        live.map((t) => {
          const judge = t.data.judge && typeof t.data.judge === "object" ? (t.data.judge as Record<string, unknown>) : null;
          const statement = typeof t.data.statement === "string" ? t.data.statement : t.title;
          return (
            <div key={t.id} className="mb-6">
              <Link href={`/node/${t.id}`} className="mb-2 block font-medium hover:underline">
                {statement}
              </Link>
              {judge ? (
                <ThesisVerdict
                  strength={typeof judge.strength === "string" ? judge.strength : "weak"}
                  rationale={typeof judge.rationale === "string" ? judge.rationale : undefined}
                  bearCase={typeof judge.bear_case === "string" ? judge.bear_case : undefined}
                  thinFlags={Array.isArray(judge.thin_reasoning_flags) ? judge.thin_reasoning_flags.filter((x): x is string => typeof x === "string") : undefined}
                  confirming={confirming.get(t.id) ?? []}
                  challenging={challenging.get(t.id) ?? []}
                  judgedAt={typeof judge.judged_at === "string" ? judge.judged_at : undefined}
                />
              ) : (
                <p className="mb-6 text-xs text-muted">Not yet judged — the critic weighs in on the next daily brief.</p>
              )}
            </div>
          );
        })
      )}

      {superseded.length > 0 && (
        <details className="mt-8 border-t border-border pt-4">
          <summary className="cursor-pointer text-sm text-muted">Replaced theses ({superseded.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {superseded.map((t) => (
              <li key={t.id} className="text-muted">
                <Link href={`/node/${t.id}`} className="line-through hover:no-underline">
                  {t.title}
                </Link>
                {t.superseded_by && (
                  <>
                    {" → "}
                    <Link href={`/node/${t.superseded_by}`} className="hover:underline">
                      replacement
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
