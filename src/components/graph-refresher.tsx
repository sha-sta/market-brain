"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/browser";
import { pendingPollDelay, shouldRefreshGraph } from "@/lib/graph-refresh";

// Always-mounted (in the (app) layout): keeps the persistent graph fresh no matter which page you're
// on. It polls the count of in-flight normalization (pending/processing raw_uploads) and invalidates
// the ["graph"] query whenever that count drops — i.e. a dump finished — so new nodes appear even if
// you navigated away from Dump before the (sequential, ~30s/file) drain completed. Renders nothing.
export function GraphRefresher({ graphId }: { graphId: string }) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const prevPending = useRef(0);

  const { data: pending = 0 } = useQuery({
    queryKey: ["normalize-pending", graphId],
    queryFn: async () => {
      const { count } = await supabase
        .from("raw_uploads")
        .select("id", { count: "exact", head: true })
        .eq("graph_id", graphId)
        .in("status", ["pending", "processing"]);
      return count ?? 0;
    },
    refetchInterval: (query) => pendingPollDelay(query.state.data ?? 0),
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (shouldRefreshGraph(prevPending.current, pending)) {
      void queryClient.invalidateQueries({ queryKey: ["graph", graphId] });
    }
    prevPending.current = pending;
  }, [pending, queryClient, graphId]);

  return null;
}
