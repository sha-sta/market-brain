import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FollowForm } from "./follow-form";
import { unfollowEntity, setKind } from "./actions";

// What the user tracks — names + industries he cares about (the daily brief and research run off this
// list). Ownership is just a flag here (no shares/P&L). Replaces the old manual portfolio. The engine
// auto-discovers related names too; this page shows the live (active) tracked set.
export const dynamic = "force-dynamic";

export default async function FollowPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const { data: tracked } = await supabase
    .from("tracked_entities")
    .select("node_id, kind, source")
    .eq("graph_id", graphId)
    .eq("candidate_status", "active")
    .order("kind");
  const ids = (tracked ?? []).map((t) => t.node_id);
  const { data: nodes } = ids.length
    ? await supabase.from("nodes").select("id, title, type").eq("graph_id", graphId).in("id", ids)
    : { data: [] };
  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Following</h1>
      <p className="mb-6 text-sm text-muted">
        The names and industries you track. Your morning brief and research run off this list. Mark what you
        own; MarketBrain surfaces, you decide.
      </p>

      <div className="mb-8 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-normal">Name</th>
              <th className="py-2 pr-3 font-normal">Type</th>
              <th className="py-2 pr-3 font-normal">Tracking as</th>
              <th className="py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {(tracked ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  Not following anything yet. Add a name or theme below.
                </td>
              </tr>
            )}
            {(tracked ?? []).map((t) => {
              const node = nodeById.get(t.node_id);
              return (
                <tr key={t.node_id} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">{node?.title ?? t.node_id}</td>
                  <td className="py-2 pr-3 font-mono text-xs uppercase tracking-wide text-muted">{node?.type ?? "·"}</td>
                  <td className="py-2 pr-3">
                    <form action={setKind} className="flex items-center gap-2">
                      <input type="hidden" name="node_id" value={t.node_id} />
                      <select
                        name="kind"
                        defaultValue={t.kind}
                        className="rounded border border-border bg-transparent px-2 py-0.5 text-xs"
                      >
                        <option value="watchlist">watchlist</option>
                        <option value="owned">owned</option>
                        <option value="theme">theme</option>
                      </select>
                      <button type="submit" className="text-xs text-muted hover:text-foreground">
                        save
                      </button>
                      {t.source === "auto" && <span className="text-xs text-muted">(auto)</span>}
                    </form>
                  </td>
                  <td className="py-2 text-right">
                    <form action={unfollowEntity}>
                      <input type="hidden" name="node_id" value={t.node_id} />
                      <button type="submit" className="text-xs text-muted hover:text-danger" title="Unfollow">
                        unfollow
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FollowForm />
    </div>
  );
}
