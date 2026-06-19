import Link from "next/link";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { restoreNode } from "../node/[id]/actions";

// The recovery surface for tiered decay: archived nodes are hidden from the graph/RAG/brief but kept
// for a grace window before the reference-guarded prune hard-deletes them. This lists them newest-first
// so a node archived too eagerly can be restored (reusing the existing restoreNode action) while it
// still exists. Once prune deletes a node, it leaves this list for good.
export const dynamic = "force-dynamic";

export default async function ArchivedPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, title, type, updated_at")
    .eq("graph_id", graphId)
    .eq("lifecycle", "archived")
    .order("updated_at", { ascending: false })
    .limit(500);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Archived</h1>
      <p className="mb-6 text-sm text-muted">
        Decayed nodes, hidden from the graph and your brief. They&apos;re kept for a grace window, then
        permanently deleted to keep the database lean. Restore one here while it&apos;s still listed.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3 font-normal">Title</th>
              <th className="py-2 pr-3 font-normal">Type</th>
              <th className="py-2 pr-3 font-normal">Archived</th>
              <th className="py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {(nodes ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  Nothing archived. Decayed news and stale signals will appear here.
                </td>
              </tr>
            )}
            {(nodes ?? []).map((n) => (
              <tr key={n.id} className="border-b border-border/60">
                <td className="py-2 pr-3 font-medium">
                  <Link href={`/node/${n.id}`} className="hover:text-foreground">
                    {n.title}
                  </Link>
                </td>
                <td className="py-2 pr-3 font-mono text-xs uppercase tracking-wide text-muted">{n.type}</td>
                <td className="py-2 pr-3 font-mono text-xs text-muted">{n.updated_at?.slice(0, 10) ?? "·"}</td>
                <td className="py-2 text-right">
                  <form action={restoreNode}>
                    <input type="hidden" name="node_id" value={n.id} />
                    <button type="submit" className="text-xs text-muted hover:text-foreground" title="Restore to active">
                      restore
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
