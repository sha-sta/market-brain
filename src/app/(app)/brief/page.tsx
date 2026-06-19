import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Today's morning brief, in-app. Renders the archived html the daily cron stored in digest_log (the
// same html that was emailed). requireActive bounces guests/pending users.
export const dynamic = "force-dynamic";

export default async function BriefPage() {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("digest_log")
    .select("html, digest_date, status")
    .eq("graph_id", graphId)
    .order("digest_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.html) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Morning brief</h1>
        <p className="text-muted">
          No brief yet. It's composed each weekday morning from what changed on the names you follow, or run the
          daily cron once to generate today's.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Morning brief</h1>
        <span className="text-sm text-muted">
          {data.digest_date}
          {data.status !== "sent" && data.status !== "archived" ? ` · ${data.status}` : ""}
        </span>
      </div>
      {/* The html is composed by our own server (compose.ts) from graph data — not user input. */}
      <div dangerouslySetInnerHTML={{ __html: data.html }} />
    </div>
  );
}
