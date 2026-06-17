import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { supabaseUrl, supabaseServiceRoleKey } from "@/lib/env";

// Service-role client — BYPASSES RLS. Server-only (the `server-only` import makes importing this
// from a client component a build error). Used by the normalization worker (M5) for upserts.
export function createAdminClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
