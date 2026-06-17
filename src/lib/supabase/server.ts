import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { supabaseUrl, supabaseAnonKey } from "@/lib/env";

// Server-side Supabase client (RSC, server actions, route handlers). Anon key => RLS enforced.
// cookies() is async in Next 16. Fresh client per request — never share across requests.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    supabaseUrl(),
    supabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (read-only cookies). Safe to ignore — the proxy
            // refreshes the session on the next request.
          }
        },
      },
    },
  );
}
