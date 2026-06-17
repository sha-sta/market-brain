import Link from "next/link";
import { getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GraphSearch } from "@/components/graph-search";
import { FatherDayHero } from "@/components/father-day-hero";
import { nodeColorForType } from "@/lib/graph-style";

// Home = the graph (rendered by the (app) layout on the right). The left panel is a quiet overview:
// a Father's Day note, counts, a search box, a legend, and a hint. Auth is handled by the layout's
// requireActive.
const TYPES = ["company", "person", "sector", "theme", "news", "filing", "thesis", "note"] as const;

export default async function HomePage() {
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const [{ count: nodeCount }, { count: edgeCount }] = await Promise.all([
    supabase.from("nodes").select("id", { count: "exact", head: true }).eq("graph_id", graphId),
    supabase.from("edges").select("id", { count: "exact", head: true }).eq("graph_id", graphId),
  ]);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <FatherDayHero />

      <div>
        <h1 className="text-2xl font-medium tracking-tight">MarketBrain</h1>
        <p className="mt-1 text-sm text-muted">
          {nodeCount ?? 0} nodes · {edgeCount ?? 0} links
        </p>
      </div>

      <GraphSearch />

      <p className="text-sm leading-relaxed text-muted">
        <span className="hidden lg:inline">The graph is on the right.</span>
        <span className="lg:hidden">Open the graph with the “Graph” button below.</span> Hover a node to
        inspect it; click to open its page. Add your own notes or theses from{" "}
        <Link href="/dump" className="text-foreground underline-offset-2 hover:underline">
          Dump
        </Link>{" "}
        and watch them settle in alongside the news.
      </p>

      <div className="mt-auto">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Node types</h2>
        <ul className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <li
              key={t}
              className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: nodeColorForType(t) }}
              />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
