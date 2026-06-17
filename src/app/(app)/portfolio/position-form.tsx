"use client";

import { useRef, useState, useTransition } from "react";
import { addPosition } from "./actions";

// Add a holding. A public company needs ticker + shares + cost basis; a private one (Anthropic,
// SpaceX) uses a manual valuation instead. Posts to the addPosition server action.
export function PositionForm() {
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
            await addPosition(fd);
            formRef.current?.reset();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to add position");
          }
        });
      }}
      className="flex flex-col gap-2 rounded border border-border p-4 text-sm"
    >
      <div className="flex flex-wrap gap-2">
        <input name="company" placeholder="Ticker or company (e.g. NVDA, Anthropic)" required className="min-w-48 flex-1 rounded border border-border bg-transparent px-2 py-1" />
        <input name="shares" type="number" step="any" placeholder="Shares" className="w-24 rounded border border-border bg-transparent px-2 py-1" />
        <input name="cost_basis" type="number" step="any" placeholder="Cost / sh" className="w-24 rounded border border-border bg-transparent px-2 py-1" />
        <input name="manual_value" type="number" step="any" placeholder="Manual $ (private)" className="w-36 rounded border border-border bg-transparent px-2 py-1" />
        <input name="account" placeholder="Account" className="w-28 rounded border border-border bg-transparent px-2 py-1" />
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-muted">
          <input name="is_watchlist" type="checkbox" /> watchlist only
        </label>
        <button type="submit" disabled={pending} className="rounded bg-foreground px-3 py-1 text-background disabled:opacity-50">
          {pending ? "Adding…" : "Add holding"}
        </button>
      </div>
      {error && <p className="text-[#a32f2f]">{error}</p>}
    </form>
  );
}
