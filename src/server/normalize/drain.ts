import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { processRawUpload, type WorkerDeps } from "./worker";
import { extractEntities } from "./extract";
import { embedTexts } from "./embed";
import { makeNeighborLookup } from "./neighbors";
import { pastDeadline } from "@/server/lib/deadline";

// Shared drain logic: claim a batch of pending raw_uploads (FOR UPDATE SKIP LOCKED) and normalize
// each. Used by the on-demand trigger after a dump (`/api/normalize/run`, active-user-gated) and the
// manual sweep (`/api/normalize/drain`, CRON_SECRET-gated). Needs the service-role client.

type Client = SupabaseClient<Database>;

/** Live worker deps for the on-demand drain + manual sweep: AI Gateway extractor + embedder + the
 *  graph-aware neighbor lookup (which needs the client — so this is a factory). The DAILY CRON passes
 *  its OWN deps to drainPending, adding the finance `enrichEntities` seam (it holds the market
 *  clients), so this base wiring stays independent of the market layer. */
export function liveDeps(supabase: Client): WorkerDeps {
  return {
    extract: extractEntities,
    embed: embedTexts,
    neighbors: makeNeighborLookup(supabase),
  };
}

export interface DrainSummary {
  processed: number;
  results: Array<{ id: string; status: string; nodes: number; error?: string }>;
}

export interface DrainOpts {
  /** Soft deadline (absolute epoch ms) for the daily cron: stop claiming new batches once past it so the
   *  300s invocation reserves budget for the digest. Checked BEFORE each claim (never mid-batch), so
   *  un-claimed rows stay `pending` for the next run and no row is stranded as `processing`. The
   *  dump-trigger + manual sweep omit it (unbounded, as before). */
  deadlineMs?: number;
}

/** Normalize ALL pending uploads, claiming `batch` at a time until none remain (or the soft deadline
 *  trips), so a single dump of many files (or a cron's batch of news rows) fully drains in one trigger.
 *  Always resolves (per-row errors are captured). SKIP LOCKED in claim_raw_uploads keeps concurrent
 *  drains from double-processing. */
export async function drainPending(supabase: Client, deps?: WorkerDeps, batch = 5, opts: DrainOpts = {}): Promise<DrainSummary> {
  const effective = deps ?? liveDeps(supabase);
  const results: DrainSummary["results"] = [];
  for (;;) {
    if (pastDeadline(opts.deadlineMs)) break; // between batches only — every claimed row finished, no orphans
    const { data: claimed, error } = await supabase.rpc("claim_raw_uploads", { batch });
    if (error) throw new Error(error.message);
    if (!claimed || claimed.length === 0) break;
    for (const row of claimed) {
      const r = await processRawUpload(supabase, row.id, effective);
      results.push({ id: r.id, status: r.status, nodes: r.nodeIds.length, error: r.error });
    }
  }
  return { processed: results.length, results };
}
