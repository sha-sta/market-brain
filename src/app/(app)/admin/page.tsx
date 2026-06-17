import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Access approval queue. requireAdmin gates the page; the RLS "profiles update admin" policy gates the
// write (a non-admin who somehow reached this action server-side still can't change another row).
export const dynamic = "force-dynamic";

async function decide(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const approve = formData.get("decision") === "approve";
  const supabase = await createClient();
  await supabase.from("profiles").update({ status: approve ? "active" : "denied" }).eq("id", id);
  revalidatePath("/admin");
}

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: pending } = await supabase
    .from("profiles")
    .select("id, email, name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const { data: members } = await supabase
    .from("profiles")
    .select("id, email, name, is_admin")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Access requests</h1>
      <p className="mb-6 text-sm text-muted">Approve people you want in this graph. When dad signs in, he'll appear here.</p>

      {!pending?.length ? (
        <p className="mb-8 text-sm text-muted">No pending requests.</p>
      ) : (
        <ul className="mb-8 flex flex-col gap-3">
          {pending.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">{p.name ?? p.email}</div>
                <div className="text-xs text-muted">{p.email}</div>
              </div>
              <div className="flex gap-2">
                <form action={decide}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Approve</button>
                </form>
                <form action={decide}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="deny" />
                  <button className="rounded-md border border-border px-3 py-1.5 text-xs">Deny</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Members</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {(members ?? []).map((m) => (
          <li key={m.id}>
            {m.name ?? m.email} <span className="text-muted">({m.email})</span>
            {m.is_admin && <span className="ml-1 text-xs text-muted">· admin</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
