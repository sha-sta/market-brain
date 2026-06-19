"use client";

import { useState, useTransition } from "react";
import { setCurrentGraph, createGraph, renameGraph } from "@/app/(app)/actions";

// The active-graph switcher in the navbar. Switching scopes ingest/search/ask to one graph;
// the server resolves the active graph off the profile, so switching just updates profiles.current_graph_id
// (via setCurrentGraph) and the revalidate re-renders the shell. Token-consistent with nav-menu.tsx.

export interface GraphOption {
  id: string;
  name: string;
}

export function GraphSelector({ graphs, currentId }: { graphs: GraphOption[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const current = graphs.find((g) => g.id === currentId);
  const currentName = current?.name ?? "Main";

  const switchTo = (id: string) => {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await setCurrentGraph(id);
      setOpen(false);
    });
  };

  const create = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await createGraph(trimmed);
      setCreating(false);
      setOpen(false);
    });
  };

  const rename = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setRenaming(null);
      return;
    }
    startTransition(async () => {
      await renameGraph(id, trimmed);
      setRenaming(null);
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Switch graph"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-foreground transition-colors hover:bg-foreground/[0.06] disabled:opacity-50"
      >
        <span className="max-w-[12rem] truncate">{currentName}</span>
        <span className="text-xs text-muted">▾</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 flex w-64 flex-col gap-0.5 rounded-md border border-border bg-surface p-1.5 text-sm shadow-lg">
            <div className="px-2 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-muted">Graphs</div>
            {graphs.map((g) =>
              renaming === g.id ? (
                <RenameRow key={g.id} initial={g.name} onSubmit={(name) => rename(g.id, name)} onCancel={() => setRenaming(null)} />
              ) : (
                <div key={g.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => switchTo(g.id)}
                    className={`flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06] disabled:opacity-50 ${
                      g.id === currentId ? "text-foreground" : "text-muted"
                    }`}
                  >
                    <span className="truncate">{g.name}</span>
                    {g.id === currentId && <span className="ml-2 shrink-0 text-xs text-muted">active</span>}
                  </button>
                  <button
                    type="button"
                    aria-label={`Rename ${g.name}`}
                    onClick={() => setRenaming(g.id)}
                    className="rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                  >
                    edit
                  </button>
                </div>
              ),
            )}

            <div className="mt-1 border-t border-border pt-1">
              {creating ? (
                <RenameRow initial="" placeholder="New graph name…" onSubmit={create} onCancel={() => setCreating(false)} />
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCreating(true)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-muted transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50"
                >
                  + New graph
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A tiny inline text input used for both creating and renaming a graph. */
function RenameRow({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSubmit(value)}
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
    />
  );
}
