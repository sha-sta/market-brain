import { describe, it, expect } from "vitest";
import { gapFillDue } from "@/server/market/gap-fill-rules";

// Commit 6 — gap-fill runs at most once per interval (weekly), so it never piles work onto the daily run.

const NOW = Date.UTC(2026, 5, 21);
const DAY = 86_400_000;

describe("gapFillDue — weekly throttle", () => {
  it("is due when never run", () => {
    expect(gapFillDue(null, NOW)).toBe(true);
  });

  it("is NOT due within the interval", () => {
    expect(gapFillDue(new Date(NOW - 1 * DAY).toISOString(), NOW)).toBe(false);
    expect(gapFillDue(new Date(NOW - 6 * DAY).toISOString(), NOW)).toBe(false);
  });

  it("is due once the interval has elapsed", () => {
    expect(gapFillDue(new Date(NOW - 7 * DAY).toISOString(), NOW)).toBe(true);
    expect(gapFillDue(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as due", () => {
    expect(gapFillDue("not-a-date", NOW)).toBe(true);
  });
});
