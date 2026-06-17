"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { GraphData, GraphNode } from "@/lib/graph";
import { matchNodes } from "@/lib/graph-filter";
import { useGraphFilter } from "./graph-filter-context";
import type { GraphLinkInfo } from "./graph-canvas";

// The persistent graph. Lives in the (app) layout so it never remounts across navigation — the
// simulation/positions survive page changes. Owns the ["graph"] query (seeded with server data),
// sizing, the active-node highlight (from the pathname), and node-click navigation. The actual
// canvas (which touches window) is dynamically imported with ssr:false.
const GraphCanvas = dynamic(() => import("./graph-canvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full" />,
});

export function GraphShell({ initialData, graphId }: { initialData: GraphData; graphId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/node/")
    ? decodeURIComponent(pathname.slice("/node/".length))
    : null;

  // Keyed by graphId: switching graphs is a clean cache-miss (seeded by the new server initialData)
  // rather than a stale flash. /api/graph resolves the same active graph server-side.
  const { data } = useQuery<GraphData>({
    queryKey: ["graph", graphId],
    queryFn: () => fetch("/api/graph").then((r) => r.json()),
    initialData,
  });
  const graph = data ?? initialData;

  const { query } = useGraphFilter();
  const filter = useMemo(() => matchNodes(graph.nodes, query), [graph.nodes, query]);
  const highlightIds = filter.active ? filter.ids : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<GraphNode | null>(null);
  const [linkHover, setLinkHover] = useState<GraphLinkInfo | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} data-testid="graph-shell" className="relative h-full w-full bg-background">
      {graph.nodes.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center p-8 text-center">
          <p className="max-w-xs text-sm text-muted">
            Your graph is empty. Head to <span className="text-foreground">Dump</span> and drop a note — it will
            normalize and appear here.
          </p>
        </div>
      ) : (
        size.width > 0 && (
          <GraphCanvas
            data={graph}
            width={size.width}
            height={size.height}
            activeId={activeId}
            highlightIds={highlightIds}
            onNodeClick={(id) => router.push(`/node/${id}`)}
            onNodeHover={setHover}
            onLinkHover={setLinkHover}
          />
        )
      )}

      {hover && (
        <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-sm">
          <div className="font-medium text-foreground">{hover.title}</div>
          <div className="text-muted">{hover.type}</div>
          {hover.tags.length > 0 && <div className="mt-1 text-muted">{hover.tags.join(" · ")}</div>}
        </div>
      )}

      {linkHover && !hover && (
        <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-sm">
          <div className="font-medium text-foreground">
            {linkHover.relations.length > 1 ? linkHover.relations.join(" · ") : linkHover.relationType}
          </div>
          <div className="text-muted">{linkHover.strong ? "verifiable (solid)" : "association (dashed)"}</div>
          <div className="mt-1 text-muted">
            {linkHover.sourceTitle} → {linkHover.targetTitle}
          </div>
        </div>
      )}

      {graph.capped && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-muted">
          showing {graph.nodes.length} of {graph.total}
        </div>
      )}
    </div>
  );
}
