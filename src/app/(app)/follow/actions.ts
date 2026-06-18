"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { normTicker } from "@/server/normalize/dedupe";
import { slugify } from "@/server/normalize/assemble";
import { reportError } from "@/lib/observability";

// Tracking CRUD: follow / unfollow a name or industry the user cares about, and flag what he owns.
// A tracked entity references an EXISTING node (resolved by ticker hard-key, then slug). Manual follows
// are source='manual', candidate_status='active' (fetched daily, never auto-decayed). RLS also enforces
// the active-user gate. This is the missing piece that turns tracked_entities into a user-editable list.

type Client = Awaited<ReturnType<typeof createClient>>;
type Kind = "owned" | "watchlist" | "theme";
const KINDS: Kind[] = ["owned", "watchlist", "theme"];

async function resolveNode(supabase: Client, graphId: string, tickerOrName: string): Promise<string | null> {
  const t = normTicker(tickerOrName);
  if (t) {
    const { data } = await supabase.from("nodes").select("id, data").eq("graph_id", graphId).eq("type", "company");
    const hit = (data ?? []).find((n) => normTicker((n.data as Record<string, unknown> | null)?.ticker) === t);
    if (hit) return hit.id;
  }
  const slug = slugify(tickerOrName);
  const { data } = await supabase.from("nodes").select("id").eq("graph_id", graphId).eq("id", slug).maybeSingle();
  return data?.id ?? null;
}

export async function followEntity(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const name = String(formData.get("entity") ?? "").trim();
  if (!name) throw new Error("Enter a ticker, company, or theme to follow.");
  const kindRaw = String(formData.get("kind") ?? "watchlist");
  const kind: Kind = KINDS.includes(kindRaw as Kind) ? (kindRaw as Kind) : "watchlist";

  const nodeId = await resolveNode(supabase, graphId, name);
  if (!nodeId) {
    throw new Error(`No "${name}" in your graph yet — dump a note about it or run a research request to add it.`);
  }
  const { error } = await supabase
    .from("tracked_entities")
    .upsert({ graph_id: graphId, node_id: nodeId, kind, source: "manual", candidate_status: "active" }, { onConflict: "graph_id,node_id" });
  if (error) {
    reportError(error, { scope: "followEntity" }); // log details server-side; don't leak schema to the client
    throw new Error("Couldn't follow that — please try again.");
  }
  revalidatePath("/follow");
}

export async function unfollowEntity(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const nodeId = String(formData.get("node_id") ?? "");
  if (!nodeId) return;
  const { error } = await supabase.from("tracked_entities").delete().eq("graph_id", graphId).eq("node_id", nodeId);
  if (error) {
    reportError(error, { scope: "unfollowEntity" });
    throw new Error("Couldn't unfollow that — please try again.");
  }
  revalidatePath("/follow");
}

export async function setKind(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const nodeId = String(formData.get("node_id") ?? "");
  const kindRaw = String(formData.get("kind") ?? "");
  if (!nodeId || !KINDS.includes(kindRaw as Kind)) return;
  const kind = kindRaw as Kind;
  // A manual kind change also claims the entry as manual, so the engine's decay never drops it.
  const { error } = await supabase
    .from("tracked_entities")
    .update({ kind, source: "manual" })
    .eq("graph_id", graphId)
    .eq("node_id", nodeId);
  if (error) {
    reportError(error, { scope: "setKind" });
    throw new Error("Couldn't update — please try again.");
  }
  revalidatePath("/follow");
}
