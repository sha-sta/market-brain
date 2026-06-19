import { describe, it, expect } from "vitest";
import { pastDeadline } from "@/server/lib/deadline";

// pastDeadline is the soft-deadline guard that time-boxes the daily run's LLM-heavy steps (drain +
// thesis-judge) so the cron always reserves budget for the digest. undefined => no deadline (the
// dump-trigger / manual-sweep callers stay unbounded), so the boundary must be exactly that.

describe("pastDeadline", () => {
  it("returns false when no deadline is set (undefined => never past)", () => {
    expect(pastDeadline(undefined)).toBe(false);
  });

  it("returns true when now is at or beyond the deadline", () => {
    expect(pastDeadline(Date.now() - 1_000)).toBe(true);
  });

  it("returns false when the deadline is in the future", () => {
    expect(pastDeadline(Date.now() + 60_000)).toBe(false);
  });
});
