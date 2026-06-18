"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { submitResearch } from "./actions";

export interface ResearchJobView {
  id: string;
  prompt: string;
  status: string;
  result: string | null;
}

// Submit a gated research request, fire the async processor, and poll the job row to completion —
// mirrors the dump box (the graph populates while the job runs). Citations in the result are shown as
// markdown links to /node/<id>.
export function ResearchBox({ initial }: { initial: ResearchJobView[] }) {
  const [supabase] = useState(() => createClient());
  const [jobs, setJobs] = useState<ResearchJobView[]>(initial);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const value = prompt.trim();
      if (!value || busy) return;
      setBusy(true);
      setMsg(null);
      const fd = new FormData();
      fd.set("prompt", value);
      const res = await submitResearch(fd);
      if (!res.ok || !res.jobId) {
        setMsg(res.message ?? "Couldn't queue that.");
        setBusy(false);
        return;
      }
      setJobs((cur) => [{ id: res.jobId!, prompt: value, status: "pending", result: null }, ...cur]);
      setPrompt("");
      if (typeof res.remaining === "number") setMsg(`${res.remaining} research request${res.remaining === 1 ? "" : "s"} left today.`);
      // Fire-and-forget the processor; the poll below reflects pending -> running -> done.
      void fetch("/api/research/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: res.jobId }),
      }).catch(() => {});
      setBusy(false);
    },
    [prompt, busy],
  );

  // Keep a ref to the latest jobs so the poll interval is STABLE (a steady 2.5s heartbeat) instead of
  // being torn down + recreated on every status update.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const hasLive = jobs.some((j) => j.status === "pending" || j.status === "running");
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(async () => {
      const live = jobsRef.current.filter((j) => j.status === "pending" || j.status === "running").map((j) => j.id);
      if (live.length === 0) return;
      const { data } = await supabase.from("research_jobs").select("id, status, result_summary").in("id", live);
      if (!data) return;
      setJobs((cur) =>
        cur.map((j) => {
          const hit = data.find((d) => d.id === j.id);
          return hit ? { ...j, status: hit.status, result: hit.result_summary } : j;
        }),
      );
    }, 2500);
    return () => clearInterval(timer);
  }, [hasLive, supabase]);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2 rounded border border-border p-4 text-sm">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should the brain dig into? e.g. 'HBM memory supply risk across my chip names' or 'who competes with IonQ on trapped-ion'"
          rows={3}
          className="w-full resize-y rounded border border-border bg-transparent px-2 py-1"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{msg}</span>
          <button type="submit" disabled={busy} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
            {busy ? "Queuing…" : "Research"}
          </button>
        </div>
      </form>

      <ul className="flex flex-col gap-3">
        {jobs.map((j) => (
          <li key={j.id} className="rounded border border-border p-3 text-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-medium">{j.prompt}</span>
              <span className="shrink-0 text-xs text-muted">{j.status === "running" ? "researching…" : j.status}</span>
            </div>
            {j.result && <p className="whitespace-pre-wrap text-muted">{j.result}</p>}
            {j.status === "failed" && <p className="text-[#a32f2f]">Research failed — try a narrower prompt.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
