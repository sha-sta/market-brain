import Link from "next/link";
import type { Profile } from "@/lib/auth";
import { MAIN_GRAPH_ID } from "@/lib/graphs";
import { createClient } from "@/lib/supabase/server";
import { NavMenu } from "@/components/nav-menu";
import { GraphSelector } from "@/components/graph-selector";

// Top navbar, rendered once by the (app) layout. Left: wordmark -> home (the graph) + the active-graph
// selector. Right: the sections (NavMenu — horizontal at >= lg, a hamburger dropdown below). `relative`
// anchors the mobile dropdown.
export async function NavBar({ profile }: { profile: Profile }) {
  const supabase = await createClient();
  const { data: graphs } = await supabase.from("graphs").select("id, name").order("created_at");
  const currentId = profile.current_graph_id ?? MAIN_GRAPH_ID;

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-lg font-medium tracking-tight text-foreground">
          MarketBrain
        </Link>
        <GraphSelector graphs={graphs ?? []} currentId={currentId} />
      </div>
      <NavMenu isAdmin={profile.is_admin} />
    </header>
  );
}
