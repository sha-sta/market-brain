import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MAIN_GRAPH_ID } from "@/lib/graphs";
import type { Database } from "@/lib/database.types";

export { MAIN_GRAPH_ID };
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// The Data Access Layer. getUser/getProfile are request-cached so calling them in multiple
// components costs one round-trip. require* perform the authorization checks and redirect.

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data;
});

/** The caller's active graph (profiles.current_graph_id), falling back to "Main". Request-cached, so
 *  every server component/route in a request resolves the same active graph in one round-trip. */
export const getCurrentGraphId = cache(async (): Promise<string> => {
  const profile = await getProfile();
  return profile?.current_graph_id ?? MAIN_GRAPH_ID;
});

/** Require a signed-in, approved user. Redirects to /sign-in or /pending otherwise. */
export async function requireActive(): Promise<Profile> {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  const profile = await getProfile();
  if (!profile || profile.status !== "active") redirect("/pending");
  return profile;
}

/** Require an approved admin. Redirects home for non-admins. */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireActive();
  if (!profile.is_admin) redirect("/");
  return profile;
}
