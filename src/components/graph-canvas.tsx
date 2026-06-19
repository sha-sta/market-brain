"use client";

import { useEffect, useRef } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { GraphData, GraphNode, GraphLink } from "@/lib/graph";
import { isStrong } from "@/server/normalize/relations";
import { FG, nodeColorForType } from "@/lib/graph-style";

// The force-graph canvas. Imports the window-touching lib directly, so it is ALWAYS loaded via a
// dynamic({ ssr:false }) boundary in graph-shell. Owns the imperative ref (center/zoom on the active
// node) so graph-shell never has to forward a ref through next/dynamic.

const BG = "#0f1113"; // background (dark charcoal — matches --background)
const DIM_ALPHA = 0.18; // search non-matches fade back, the rest stay full strength
const LINK_STRONG = "#5b636c"; // solid edges (verifiable relations) — lifted to read on charcoal
const LINK_WEAK = "#363d44"; // dashed edges (association) — dim, recessive on the dark bg

type FGNode = NodeObject<GraphNode>;
type FGLink = { source: unknown; target: unknown; relation_type?: string; relations?: string[]; strong?: boolean };

// What the edge-hover tooltip shows: the representative relation type, every relation on the
// collapsed node pair, whether it's a strong (solid) or weak (dashed) edge, and the two endpoints.
export interface GraphLinkInfo {
  relationType: string;
  relations: string[];
  strong: boolean;
  sourceTitle: string;
  targetTitle: string;
}

const endpointTitle = (e: unknown): string =>
  e && typeof e === "object" ? String((e as FGNode).title ?? (e as FGNode).id ?? "") : String(e ?? "");

interface Props {
  data: GraphData;
  width: number;
  height: number;
  activeId: string | null;
  // Search highlight: null => no filter (all nodes full strength); a Set => only its members stay
  // full and the rest dim (an empty Set dims everything — clear "no results" feedback).
  highlightIds?: Set<string> | null;
  onNodeClick: (id: string) => void;
  onNodeHover: (node: GraphNode | null) => void;
  onLinkHover: (info: GraphLinkInfo | null) => void;
}

export default function GraphCanvas({
  data,
  width,
  height,
  activeId,
  highlightIds,
  onNodeClick,
  onNodeHover,
  onLinkHover,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);

  // A slow, graceful settle (the Obsidian feel) rather than a snap.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-120);
  }, []);

  // Center + zoom the active node when the route is /node/[id].
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !activeId) return;
    const n = data.nodes.find((x) => x.id === activeId) as (FGNode & { x?: number; y?: number }) | undefined;
    if (n && typeof n.x === "number" && typeof n.y === "number") {
      fg.centerAt(n.x, n.y, 600);
      fg.zoom(2.6, 600);
    }
  }, [activeId, data]);

  const radius = (n: FGNode) => 2 + Math.sqrt(n.degree ?? 0) * 1.4;

  return (
    <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor={BG}
      nodeRelSize={4}
      d3VelocityDecay={0.32}
      d3AlphaDecay={0.0228}
      cooldownTicks={120}
      nodeVal={(n) => 1 + (n.degree ?? 0)}
      onNodeClick={(n) => n.id != null && onNodeClick(String(n.id))}
      onNodeHover={(n) => onNodeHover(n ? (n as FGNode) : null)}
      onLinkHover={(l) => {
        if (!l) return onLinkHover(null);
        const link = l as FGLink;
        const relationType = String(link.relation_type ?? "relates_to");
        onLinkHover({
          relationType,
          relations: link.relations ?? [relationType],
          strong: link.strong ?? isStrong(relationType),
          sourceTitle: endpointTitle(link.source),
          targetTitle: endpointTitle(link.target),
        });
      }}
      linkColor={(l) => ((l as FGLink).strong ? LINK_STRONG : LINK_WEAK)}
      linkWidth={(l) => ((l as FGLink).strong ? 1.2 : 0.7)}
      linkLineDash={(l) => ((l as FGLink).strong ? null : [2, 3])}
      nodeCanvasObject={(node, ctx, scale) => {
        const n = node as FGNode & { x: number; y: number };
        const r = radius(n);
        const active = n.id === activeId;
        const dimmed = highlightIds != null && !highlightIds.has(n.id) && !active;
        ctx.globalAlpha = dimmed ? DIM_ALPHA : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = active ? FG : nodeColorForType(n.type);
        ctx.fill();
        if (active) {
          ctx.lineWidth = 1.5 / scale;
          ctx.strokeStyle = FG;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI);
          ctx.stroke();
        }
        // Labels appear once zoomed in, or always for the active node.
        if (scale > 1.6 || active) {
          const label = n.title ?? "";
          ctx.font = `${Math.max(11 / scale, 2)}px Georgia, serif`;
          ctx.fillStyle = FG;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label, n.x, n.y + r + 1.5);
        }
        ctx.globalAlpha = 1;
      }}
      nodePointerAreaPaint={(node, color, ctx) => {
        const n = node as FGNode & { x: number; y: number };
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius(n) + 2, 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
  );
}
