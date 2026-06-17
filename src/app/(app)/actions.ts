"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActive } from "@/lib/auth";

/** Sign the current user out and return to the sign-in screen. Used by the navbar. */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

/** Switch the caller's active graph. Everything (ingest/search/ask) then scopes to it.
 *  revalidatePath("/","layout") re-renders the shell so the persistent graph + counts reflect it. */
export async function setCurrentGraph(graphId: string): Promise<void> {
  const profile = await requireActive();
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ current_graph_id: graphId }).eq("id", profile.id);
  if (error) throw new Error(`switch graph failed: ${error.message}`);
  revalidatePath("/", "layout");
}

/** Create a new (empty) named graph and switch to it. Shared partition: every active user can see it. */
export async function createGraph(name: string): Promise<void> {
  const profile = await requireActive();
  const trimmed = name.trim() || "Untitled graph";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("graphs")
    .insert({ name: trimmed, created_by: profile.id })
    .select("id")
    .single();
  if (error || !data) throw new Error(`create graph failed: ${error?.message ?? "no row"}`);
  const { error: switchErr } = await supabase
    .from("profiles")
    .update({ current_graph_id: data.id })
    .eq("id", profile.id);
  if (switchErr) throw new Error(`switch to new graph failed: ${switchErr.message}`);
  revalidatePath("/", "layout");
}

/** Rename a graph. */
export async function renameGraph(graphId: string, name: string): Promise<void> {
  await requireActive();
  const trimmed = name.trim();
  if (!trimmed) return;
  const supabase = await createClient();
  const { error } = await supabase.from("graphs").update({ name: trimmed }).eq("id", graphId);
  if (error) throw new Error(`rename graph failed: ${error.message}`);
  revalidatePath("/", "layout");
}
