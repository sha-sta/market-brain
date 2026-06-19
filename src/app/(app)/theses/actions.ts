"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { uploadText } from "@/lib/dump";
import { drainPending } from "@/server/normalize/drain";
import { reportError } from "@/lib/observability";
import { validateThesisStatement, formatThesisDump } from "./thesis-input";

// Add a thesis by piping its text through the EXISTING dump/normalize pipeline (uploadText ->
// raw_uploads -> drain -> extractor -> a `thesis` node + links + embedding), NOT a bespoke insert — so
// dump-based thesis extraction stays the single code path. Expected errors are RETURNED, never thrown
// (a thrown server-action Error is redacted in prod). Active-user gated.
export type AddThesisResult = { ok: true } | { ok: false; message: string };

export async function addThesis(formData: FormData): Promise<AddThesisResult> {
  const profile = await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const v = validateThesisStatement(String(formData.get("statement") ?? ""));
  if (!v.ok) return v;
  const about = String(formData.get("about") ?? "");
  const text = formatThesisDump(v.statement, about);

  try {
    await uploadText(supabase, profile.id, graphId, text);
  } catch (e) {
    reportError(e, { scope: "addThesis" });
    return { ok: false, message: "Couldn't save your thesis. Please try again." };
  }

  // Drain now (best-effort) so the thesis node + verdict appear without waiting for the daily cron — the
  // same on-demand path /dump uses. If the AI Gateway is down, the pending upload drains on the next run.
  try {
    await drainPending(createAdminClient());
  } catch (e) {
    reportError(e, { scope: "addThesis.drain" });
  }

  revalidatePath("/theses");
  return { ok: true };
}
