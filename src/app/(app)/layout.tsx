import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGraph } from "@/lib/graph";
import { Providers } from "./providers";
import { NavBar } from "@/components/nav-bar";
import { GraphPanel } from "@/components/graph-panel";
import { MobileGraphToggle } from "@/components/mobile-graph-toggle";
import { GraphRefresher } from "@/components/graph-refresher";

// The app shell: one gate (requireActive) for every signed-in page, a persistent top navbar, and the
// living graph on the right that never remounts as you navigate (App Router keeps this layout
// subtree mounted). Each page renders into the left panel. sign-in/pending stay OUTSIDE this group.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const graph = await getGraph(supabase, graphId);

  return (
    <Providers>
      <GraphRefresher graphId={graphId} />
      <div className="flex h-screen flex-col">
        <NavBar profile={profile} />
        <div className="flex min-h-0 flex-1">
          <aside className="w-full shrink-0 overflow-y-auto border-r border-border lg:max-w-md">{children}</aside>
          {/* >= lg: persistent right panel. < lg: a toggleable bottom sheet (GraphShell never remounts). */}
          <GraphPanel initialData={graph} graphId={graphId} />
        </div>
        <MobileGraphToggle />
      </div>
    </Providers>
  );
}
