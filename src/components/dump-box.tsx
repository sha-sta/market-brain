"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/browser";
import { uploadFile, uploadText } from "@/lib/dump";

type Item = { id: string; label: string; status: string; costUsd?: number };

/** Pull the estimated $ cost out of a raw_uploads.usage jsonb blob (UsageTotals shape), if present. */
function costOf(usage: unknown): number | undefined {
  if (usage && typeof usage === "object" && "costUsd" in usage) {
    const c = (usage as { costUsd: unknown }).costUsd;
    if (typeof c === "number") return c;
  }
  return undefined;
}

// Per-file progress. Normalization has no real percentage (pending -> processing -> done), so the
// bar is empty while queued, an indeterminate sweep while the LLM runs, and full when done.
function StatusBar({ status }: { status: string }) {
  if (status === "failed") return <span className="shrink-0 text-xs text-red-600">failed</span>;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="w-16 text-right text-xs text-muted">{status === "processing" ? "normalizing" : status}</span>
      <div className="h-1 w-24 overflow-hidden rounded-full bg-border">
        {status === "processing" ? (
          <div className="h-full w-1/3 rounded-full bg-foreground [animation:indeterminate_1.2s_ease-in-out_infinite]" />
        ) : (
          <div
            className="h-full rounded-full bg-foreground transition-all duration-500"
            style={{ width: status === "done" ? "100%" : "0%" }}
          />
        )}
      </div>
    </div>
  );
}

export function DumpBox({ uid, graphId }: { uid: string; graphId: string }) {
  const [supabase] = useState(() => createClient());
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Normalization is on-demand: trigger it right after an upload. Fire-and-forget — the status poll
  // below reflects pending -> processing -> done regardless of this response.
  const kickNormalize = useCallback(() => {
    void fetch("/api/normalize/run", { method: "POST" }).catch(() => {});
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true);
      let uploaded = false;
      for (const file of Array.from(files)) {
        try {
          const { id } = await uploadFile(supabase, uid, graphId, file);
          setItems((cur) => [{ id, label: file.name, status: "pending" }, ...cur]);
          uploaded = true;
        } catch {
          setItems((cur) => [
            { id: crypto.randomUUID(), label: `${file.name} — upload failed`, status: "failed" },
            ...cur,
          ]);
        }
      }
      if (uploaded) kickNormalize();
      setBusy(false);
    },
    [supabase, uid, graphId, kickNormalize],
  );

  const submitText = useCallback(async () => {
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    try {
      const { id } = await uploadText(supabase, uid, graphId, value);
      setItems((cur) => [{ id, label: value.slice(0, 60), status: "pending" }, ...cur]);
      setText("");
      kickNormalize();
    } catch {
      setItems((cur) => [
        { id: crypto.randomUUID(), label: "paste — upload failed", status: "failed" },
        ...cur,
      ]);
    } finally {
      setBusy(false);
    }
  }, [supabase, uid, graphId, text, kickNormalize]);

  // Poll the status of in-flight uploads so the UI tracks normalization progress.
  useEffect(() => {
    const live = items.filter((i) => i.status === "pending" || i.status === "processing").map((i) => i.id);
    if (live.length === 0) return;
    const timer = setInterval(async () => {
      const { data } = await supabase.from("raw_uploads").select("id, status, usage").in("id", live);
      if (!data) return;
      setItems((cur) =>
        cur.map((i) => {
          const hit = data.find((d) => d.id === i.id);
          return hit ? { ...i, status: hit.status, costUsd: costOf(hit.usage) } : i;
        }),
      );
      // A completed upload means new nodes exist — refetch the active graph so it animates them in.
      if (data.some((d) => d.status === "done")) {
        void queryClient.invalidateQueries({ queryKey: ["graph", graphId] });
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [items, supabase, queryClient, graphId]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files"
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-10 text-center text-sm transition ${
          dragging ? "border-foreground bg-background" : "border-border"
        }`}
      >
        <span className="font-medium">Drop files here</span>
        <span className="text-xs text-muted">or click to choose · .md .txt · multiple at once</span>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".md,.markdown,.txt"
          className="hidden"
          onChange={(e) => e.target.files && void addFiles(e.target.files)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…or paste a brainstorm / notes here"
          rows={4}
          className="w-full rounded-md border border-border p-3 text-sm"
        />
        <button
          onClick={() => void submitText()}
          disabled={busy || !text.trim()}
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy ? "Uploading…" : "Add to graph"}
        </button>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="truncate pr-3">{i.label}</span>
              <div className="flex shrink-0 items-center gap-3">
                {i.status === "done" && i.costUsd !== undefined && (
                  <span className="text-xs tabular-nums text-muted">${i.costUsd.toFixed(4)}</span>
                )}
                <StatusBar status={i.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
