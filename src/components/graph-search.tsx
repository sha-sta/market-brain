"use client";

import { useGraphFilter } from "./graph-filter-context";

// Quiet editorial search field for the home panel. Typing dims every node on the graph except
// title/type/tag matches (see graph-shell + matchNodes). Clearing it restores the full graph.
export function GraphSearch() {
  const { query, setQuery } = useGraphFilter();
  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the graph…"
        aria-label="Search the graph"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-foreground/40 focus:outline-none"
      />
    </div>
  );
}
