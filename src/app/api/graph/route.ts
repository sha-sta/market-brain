import "server-only";
import { getProfile, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGraph } from "@/lib/graph";

// Whole-graph JSON for the persistent home force-graph. Self-auths (the proxy excludes /api): active
// users only; uses the RLS client so it returns only the caller's visible nodes. Client-fetchable so
// the graph can refetch (and animate new nodes in) after a dump completes.
export async function GET() {
  const profile = await getProfile();
  if (!profile || profile.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const graphId = await getCurrentGraphId();
  return Response.json(await getGraph(supabase, graphId));
}
