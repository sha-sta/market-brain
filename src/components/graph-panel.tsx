"use client";

import { GraphShell } from "@/components/graph-shell";
import { useMobileGraph } from "@/components/mobile-graph-context";
import type { GraphData } from "@/lib/graph";

// The graph container. At >= lg it's the persistent right panel (a flex item). Below lg it becomes a
// fixed bottom sheet that slides up when toggled. CRITICAL: it hides via `translate-y` (never
// `display:none`) so the element keeps a real size — GraphShell's ResizeObserver stays correct and the
// force simulation never resets — and GraphShell is rendered exactly once (never remounts).
export function GraphPanel({ initialData, graphId }: { initialData: GraphData; graphId: string }) {
  const { visible, close } = useMobileGraph();
  return (
    <>
      {visible && (
        <div
          aria-hidden
          onClick={close}
          className="fixed inset-0 top-14 z-30 bg-black/20 lg:hidden"
        />
      )}
      <div
        className={[
          "relative min-w-0 bg-background",
          "lg:flex-1 lg:border-l lg:border-border",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-14 max-lg:z-40",
          "max-lg:border-t max-lg:border-border max-lg:shadow-2xl",
          "max-lg:transition-transform max-lg:duration-300 max-lg:ease-out",
          visible ? "max-lg:translate-y-0" : "max-lg:translate-y-full",
        ].join(" ")}
      >
        <GraphShell initialData={initialData} graphId={graphId} />
      </div>
    </>
  );
}
