"use client";

import { useRef, useState, useTransition } from "react";
import { addThesis } from "./actions";

// Write a thesis — your standing view on a name or theme. It flows through the same pipeline as a dump,
// so the extractor turns it into a thesis node that the strict critic then stress-tests in the brief.
export function AddThesisForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        setDone(false);
        startTransition(async () => {
          try {
            const res = await addThesis(fd);
            if (res.ok) {
              formRef.current?.reset();
              setDone(true);
            } else {
              setError(res.message);
            }
          } catch {
            setError("Something went wrong. Please try again.");
          }
        });
      }}
      className="flex flex-col gap-2 rounded border border-border p-4 text-sm"
    >
      <textarea
        name="statement"
        required
        rows={3}
        placeholder="Your thesis — e.g. NVIDIA stays the AI compute bellwether through the next cycle."
        className="w-full rounded border border-border bg-transparent px-2 py-1"
      />
      <div className="flex flex-wrap gap-2">
        <input
          name="about"
          placeholder="About (optional): [[nvidia]] [[artificial-intelligence]]"
          className="min-w-64 flex-1 rounded border border-border bg-transparent px-2 py-1"
        />
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
          {pending ? "Adding…" : "Add thesis"}
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
      {done && <p className="text-muted">Added — the critic will weigh in on your next brief.</p>}
    </form>
  );
}
