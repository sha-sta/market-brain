"use server";

import { createClient } from "@/lib/supabase/server";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { researchDailyQuota } from "@/lib/env";
import { reportError } from "@/lib/observability";

// Queue a gated research job. requireActive gates it; the requester + graph are server-resolved (never
// from form input). A rolling-24h quota bounds cost. Returns the job id so the client can fire the
// async processor and poll the row. (The processor mutates status/result via service_role.)

export interface SubmitResult {
  ok: boolean;
  jobId?: string;
  message?: string;
  remaining?: number;
}

const DAY_MS = 86_400_000;

export async function submitResearch(formData: FormData): Promise<SubmitResult> {
  const profile = await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return { ok: false, message: "Enter what you'd like researched." };
  if (prompt.length > 2000) return { ok: false, message: "Keep the request under 2000 characters." };

  const quota = researchDailyQuota();
  const sinceIso = new Date(Date.now() - DAY_MS).toISOString();
  const { count } = await supabase
    .from("research_jobs")
    .select("id", { count: "exact", head: true })
    .eq("requester", profile.id)
    .gte("created_at", sinceIso);
  const used = count ?? 0;
  if (used >= quota) {
    return { ok: false, message: `Daily research limit reached (${quota} per 24h). Try again later.`, remaining: 0 };
  }

  const ins = await supabase
    .from("research_jobs")
    .insert({ graph_id: graphId, requester: profile.id, prompt })
    .select("id")
    .single();
  if (ins.error) {
    reportError(ins.error, { scope: "submitResearch" });
    return { ok: false, message: "Couldn't queue that. Please try again." };
  }
  return { ok: true, jobId: ins.data.id, remaining: Math.max(0, quota - used - 1) };
}
