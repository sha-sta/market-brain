import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

// Integration-test harness against the LOCAL isolated test Supabase stack (project marketbrain_test,
// ports 5533x, started via `npm run db:test:start`). Creates real auth users + RLS-scoped clients —
// no mocks; exercises real policies/grants/RPCs.

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:55331";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Service-role client — bypasses RLS. Seeds/cleans up + stands in for the worker/cron. */
export function adminClient(): Client {
  return createClient<Database>(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** The default "Main" graph seeded by migration 0023. cleanupAll preserves it. */
export const TEST_GRAPH_ID = "00000000-0000-0000-0000-0000000000aa";

export type Status = "pending" | "active" | "denied";

export interface TestUser {
  id: string;
  email: string;
  client: Client; // signed-in, anon-key (RLS enforced)
}

const PASSWORD = "test-password-123";
let seq = 0;

/** Create a confirmed auth user, set its profile status/admin, return a signed-in RLS-scoped client. */
export async function createUser(
  emailPrefix: string,
  opts: { status: Status; isAdmin?: boolean } = { status: "active" },
): Promise<TestUser> {
  const admin = adminClient();
  const email = `${emailPrefix}-${++seq}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const id = data.user.id;
  const { error: upErr } = await admin
    .from("profiles")
    .update({ status: opts.status, is_admin: opts.isAdmin ?? false })
    .eq("id", id);
  if (upErr) throw new Error(`profile update failed: ${upErr.message}`);

  const client = createClient<Database>(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signErr) throw new Error(`signIn failed: ${signErr.message}`);
  return { id, email, client };
}

/** Wipe graph + finance tables and delete @local.test users so each suite starts clean. Runs only
 *  against the dedicated local test instance (refuses any non-local URL). */
export async function cleanupAll(): Promise<void> {
  const admin = adminClient();
  if (!URL.includes("127.0.0.1") && !URL.includes("localhost")) {
    throw new Error(`cleanupAll refused: SUPABASE_URL is not local (${URL})`);
  }
  const ZERO = "00000000-0000-0000-0000-000000000000";
  // Graph-scoped children first (most cascade off nodes, but delete explicitly for a deterministic wipe).
  await admin.from("node_merge_candidates").delete().neq("id", ZERO);
  await admin.from("edges").delete().neq("id", ZERO);
  await admin.from("alert_events").delete().neq("id", ZERO);
  await admin.from("alert_rules").delete().neq("id", ZERO);
  await admin.from("price_snapshots").delete().neq("id", ZERO);
  await admin.from("tracked_entities").delete().neq("node_id", "");
  await admin.from("digest_log").delete().neq("id", ZERO);
  await admin.from("assets").delete().neq("id", ZERO);
  await admin.from("raw_uploads").delete().neq("id", ZERO);
  await admin.from("nodes").delete().neq("id", "");
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (u.email?.endsWith("@local.test")) await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("graphs").delete().neq("id", TEST_GRAPH_ID);
}
