import { redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// "Awaiting approval" screen. Active users are bounced home; signed-out users to sign-in.
export default async function PendingPage() {
  const user = await getUser();
  if (!user) redirect("/sign-in");
  const profile = await getProfile();
  if (profile?.status === "active") redirect("/");

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/sign-in");
  }

  const denied = profile?.status === "denied";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{denied ? "Access denied" : "Awaiting approval"}</h1>
      <p className="max-w-md text-sm text-muted">
        {denied
          ? "Your request to access MarketBrain was declined. Contact an admin if you think this is a mistake."
          : "Your account is pending. An admin needs to approve you before you can read or write the graph."}
      </p>
      <p className="text-xs text-muted">{user.email}</p>
      <form action={signOut}>
        <button className="rounded-md border border-border px-4 py-2 text-sm hover:bg-gray-50">
          Sign out
        </button>
      </form>
    </main>
  );
}
