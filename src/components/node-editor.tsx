import { editNodeField, archiveNode, restoreNode } from "@/app/(app)/node/[id]/actions";

// Manual living-graph control, rendered on a node page (active users). A server component using native
// <form action={serverAction}> + <details> — no client JS. Each editable field saves through the
// writeNodeData choke-point (snapshot + re-embed); Archive/Restore flips lifecycle; History lists the
// node_revisions trail.

export interface EditableField {
  field: string;
  label: string;
  value: string;
}
export interface RevisionView {
  reason: string;
  changedAt: string;
}

export function NodeEditor({
  nodeId,
  lifecycle,
  fields,
  revisions,
}: {
  nodeId: string;
  lifecycle: string;
  fields: EditableField[];
  revisions: RevisionView[];
}) {
  return (
    <details className="mb-6 rounded border border-border p-4 text-sm">
      <summary className="cursor-pointer text-muted">Edit / archive this node</summary>
      <div className="mt-3 flex flex-col gap-3">
        {fields.map((f) => (
          <form key={f.field} action={editNodeField} className="flex flex-col gap-1">
            <label className="text-xs text-muted">{f.label}</label>
            <input type="hidden" name="node_id" value={nodeId} />
            <input type="hidden" name="field" value={f.field} />
            <textarea
              name="value"
              defaultValue={f.value}
              rows={f.field === "body" ? 4 : 2}
              className="rounded border border-border bg-transparent px-2 py-1"
            />
            <button type="submit" className="self-start rounded border border-border px-2 py-0.5 text-xs hover:bg-border">
              Save {f.label}
            </button>
          </form>
        ))}

        <form action={lifecycle === "archived" ? restoreNode : archiveNode}>
          <input type="hidden" name="node_id" value={nodeId} />
          <button type="submit" className="rounded border border-border px-2 py-0.5 text-xs hover:bg-border">
            {lifecycle === "archived" ? "Restore" : "Archive (hide from views, brief, and Ask)"}
          </button>
        </form>

        {revisions.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted">History ({revisions.length})</summary>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
              {revisions.map((r, i) => (
                <li key={i}>
                  {r.changedAt.slice(0, 10)} · {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  );
}
