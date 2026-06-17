"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { normTicker } from "@/server/normalize/dedupe";
import { slugify } from "@/server/normalize/assemble";

// Portfolio mutations. Active-user gated (RLS also enforces it). Positions reference an EXISTING
// company node — resolved by ticker hard-key then slug — so a holding always ties to the graph.

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function resolveCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  graphId: string,
  tickerOrName: string,
): Promise<string | null> {
  const t = normTicker(tickerOrName);
  if (t) {
    const { data } = await supabase.from("nodes").select("id, data").eq("graph_id", graphId).eq("type", "company");
    const hit = (data ?? []).find((n) => normTicker((n.data as Record<string, unknown> | null)?.ticker) === t);
    if (hit) return hit.id;
  }
  const slug = slugify(tickerOrName);
  const { data } = await supabase
    .from("nodes")
    .select("id")
    .eq("graph_id", graphId)
    .eq("type", "company")
    .eq("id", slug)
    .maybeSingle();
  return data?.id ?? null;
}

export async function addPosition(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const company = String(formData.get("company") ?? "").trim();
  if (!company) throw new Error("Enter a company ticker or name.");
  const nodeId = await resolveCompany(supabase, graphId, company);
  if (!nodeId) {
    throw new Error(`No company "${company}" in your graph yet — add it with a dump, or wait for news to surface it.`);
  }

  const { error } = await supabase.from("positions").insert({
    graph_id: graphId,
    node_id: nodeId,
    shares: numOrNull(formData.get("shares")),
    cost_basis: numOrNull(formData.get("cost_basis")),
    manual_value: numOrNull(formData.get("manual_value")),
    account: String(formData.get("account") ?? "").trim() || null,
    is_watchlist: formData.get("is_watchlist") === "on",
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) throw new Error(`Add position failed: ${error.message}`);
  revalidatePath("/portfolio");
}

export async function deletePosition(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("positions").delete().eq("graph_id", graphId).eq("id", id);
  if (error) throw new Error(`Remove position failed: ${error.message}`);
  revalidatePath("/portfolio");
}
