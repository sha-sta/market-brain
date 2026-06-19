"use client";

import { useRef, useState, useTransition } from "react";
import { followEntity } from "./actions";

// Follow a name or industry. Resolves an existing company (by ticker/name) or theme/sector (by name).
// owned = a holding (no shares — check Fidelity for P&L); watchlist = interested; theme = an industry.
export function FollowForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          try {
            const res = await followEntity(fd);
            if (res.ok) formRef.current?.reset();
            else setError(res.message);
          } catch {
            setError("Something went wrong. Please try again.");
          }
        });
      }}
      className="flex flex-col gap-2 rounded border border-border p-4 text-sm"
    >
      <div className="flex flex-wrap gap-2">
        <input
          name="entity"
          placeholder="Ticker, company, or theme (e.g. NVDA, Anthropic, quantum-computing)"
          required
          className="min-w-64 flex-1 rounded border border-border bg-transparent px-2 py-1"
        />
        <select name="kind" defaultValue="watchlist" className="rounded border border-border bg-transparent px-2 py-1">
          <option value="watchlist">watchlist</option>
          <option value="owned">owned</option>
          <option value="theme">theme</option>
        </select>
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
          {pending ? "Following…" : "Follow"}
        </button>
      </div>
      {error && <p className="text-danger">{error}</p>}
    </form>
  );
}
