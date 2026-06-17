"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GraphFilterProvider } from "@/components/graph-filter-context";
import { MobileGraphProvider } from "@/components/mobile-graph-context";

// Client provider for TanStack Query. The persistent GraphShell and the DumpBox both live under it,
// so a dump can invalidate the ["graph"] query and the graph refetches + animates new nodes in.
// GraphFilterProvider rides alongside it so the home-panel search box and the graph share one query.
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <GraphFilterProvider>
        <MobileGraphProvider>{children}</MobileGraphProvider>
      </GraphFilterProvider>
    </QueryClientProvider>
  );
}
