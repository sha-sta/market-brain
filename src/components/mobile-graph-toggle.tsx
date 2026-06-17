"use client";

import { useMobileGraph } from "@/components/mobile-graph-context";

// Floating button shown only below lg, to reveal/hide the graph bottom-sheet. Hidden at >= lg, where
// the graph is always the right panel.
export function MobileGraphToggle() {
  const { visible, toggle } = useMobileGraph();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={visible}
      aria-label={visible ? "Hide graph" : "Show graph"}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg lg:hidden"
    >
      {visible ? "Hide graph" : "Graph"}
    </button>
  );
}
