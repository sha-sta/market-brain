import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { DumpBox } from "@/components/dump-box";

// Auth-gated dump box. requireActive bounces guests/pending users away. Uploads land in the active
// graph (resolved server-side; the worker reads it off each raw_uploads row).
export default async function DumpPage() {
  const profile = await requireActive();
  const graphId = await getCurrentGraphId();
  return (
    <div className="p-6">
      <h1 className="mb-1 mt-2 text-xl font-semibold">Dump</h1>
      <p className="mb-6 text-sm text-muted">
        Drop files or paste text. It gets normalized into the active graph — deduped against
        what&apos;s already there.
      </p>
      <DumpBox uid={profile.id} graphId={graphId} />
    </div>
  );
}
