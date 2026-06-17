"use client";

import { createContext, useContext, useState } from "react";

// Shared search-query state for the persistent graph. The search box lives in the home page's left
// panel while the graph lives in the (app) layout's right pane — they're sibling subtrees, so the
// query has to ride a context that wraps both (mounted inside Providers, alongside the QueryClient).

interface GraphFilterValue {
  query: string;
  setQuery: (q: string) => void;
}

const GraphFilterContext = createContext<GraphFilterValue | null>(null);

export function GraphFilterProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  return <GraphFilterContext.Provider value={{ query, setQuery }}>{children}</GraphFilterContext.Provider>;
}

export function useGraphFilter(): GraphFilterValue {
  const ctx = useContext(GraphFilterContext);
  if (!ctx) throw new Error("useGraphFilter must be used within a GraphFilterProvider");
  return ctx;
}
