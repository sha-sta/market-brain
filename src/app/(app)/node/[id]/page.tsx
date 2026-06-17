import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAssets, getNeighbors, getNode, getRelated, type Neighbor } from "@/lib/graph";
import { formatScalar, isEmptyValue, isRenderableRecord } from "@/lib/field-format";

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);

// Render one node-data field value: arrays join, plain objects (e.g. person.links) become a small
// key/value sub-list (instead of "[object Object]"), URLs linkify, everything else coerces safely.
function FieldValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <>{value.map(formatScalar).join(", ")}</>;
  if (isRenderableRecord(value)) {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>
              {isUrl(v) ? (
                <a href={v} target="_blank" rel="noreferrer" className="break-all hover:underline">
                  {v}
                </a>
              ) : (
                formatScalar(v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="break-all hover:underline">
        {value}
      </a>
    );
  }
  return <>{formatScalar(value)}</>;
}

function NeighborList({ label, items }: { label: string; items: Neighbor[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((e, i) => (
          <li key={`${e.node.id}-${i}`} className="text-sm">
            <span className="text-muted">{e.type}: </span>
            <Link href={`/node/${e.node.id}`} className="hover:underline">
              {e.node.title}
            </Link>
            <span className="text-xs text-muted"> ({e.node.type})</span>
            {e.support >= 2 && <span className="ml-1 text-xs text-muted">· corroborated by {e.support} sources</span>}
            {e.evidence && <span className="mt-0.5 block pl-3 text-xs italic text-muted">“{e.evidence}”</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Node detail: fields, edges (in/out), linked assets, and a pgvector "related" panel.
// Next 16: params is a Promise.
export default async function NodePage({ params }: { params: Promise<{ id: string }> }) {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const { id } = await params;
  const supabase = await createClient();
  const node = await getNode(supabase, id, graphId);
  if (!node) notFound();

  const [neighbors, related, assets] = await Promise.all([
    getNeighbors(supabase, id, graphId),
    getRelated(supabase, node),
    getAssets(supabase, id, graphId),
  ]);

  const data = (node.data ?? {}) as Record<string, unknown>;
  const body = typeof data.body === "string" ? data.body : "";
  const fields = Object.entries(data).filter(([k, v]) => k !== "body" && !isEmptyValue(v));
  const nodeTags = node.tags ?? [];

  // Provenance edges ("mentions") get their own sections; everything else stays in the link lists.
  const isMention = (e: Neighbor) => e.type === "mentions";
  const mentions = neighbors.outgoing.filter(isMention); // this note -> entities it mentions
  const mentionedIn = neighbors.incoming.filter(isMention); // notes that mention this entity
  const linksOut = neighbors.outgoing.filter((e) => !isMention(e));
  const linkedFrom = neighbors.incoming.filter((e) => !isMention(e));

  return (
    <div className="p-6">
      <header className="mb-6 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">{node.title}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{node.type}</span>
        {node.status && <span className="text-xs text-muted">{node.status}</span>}
        {nodeTags.length > 0 && (
          <span className="flex w-full flex-wrap gap-1.5">
            {nodeTags.map((t) => (
              <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{t}</span>
            ))}
          </span>
        )}
      </header>

      {fields.length > 0 && (
        <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>
                <FieldValue value={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {body && <p className="mb-6 whitespace-pre-wrap text-sm text-foreground">{body}</p>}

      {assets.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {assets.map((a) =>
            a.url ? (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">
                {a.caption ?? a.kind}
              </a>
            ) : null,
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <NeighborList label="Mentions" items={mentions} />
        <NeighborList label="Mentioned in" items={mentionedIn} />
        <NeighborList label="Links out" items={linksOut} />
        <NeighborList label="Linked from" items={linkedFrom} />

        {related.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Related</h3>
            <ul className="flex flex-col gap-1">
              {related.map((r) => (
                <li key={r.id} className="text-sm">
                  <Link href={`/node/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                  <span className="text-xs text-muted"> ({r.type})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
