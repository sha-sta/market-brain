import { describe, expect, it } from "vitest";
import { lastMarketCloseMs } from "@/server/market/market-hours";

const TZ = "America/New_York";
const etWeekday = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(ms));
const etDate = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const etHm = (ms: number) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

describe("lastMarketCloseMs", () => {
  it("is 4:30pm ET on a weekday, strictly before now", () => {
    const now = Date.UTC(2026, 6, 7, 11, 0); // Tue Jul 7 2026, ~7am ET (EDT)
    const close = lastMarketCloseMs(now);
    expect(close).toBeLessThan(now);
    expect(etHm(close)).toBe("16:30");
    expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(etWeekday(close));
  });

  it("resolves a weekday morning to the prior trading day's close", () => {
    const now = Date.UTC(2026, 6, 7, 11, 0); // Tue Jul 7 2026, ~7am ET
    const close = lastMarketCloseMs(now);
    expect(etWeekday(close)).toBe("Mon");
    expect(etDate(close)).toBe("2026-07-06");
    expect(etHm(close)).toBe("16:30");
  });

  it("resolves a Monday morning back to Friday's close (skips the weekend)", () => {
    const now = Date.UTC(2026, 6, 6, 11, 0); // Mon Jul 6 2026, ~7am ET
    const close = lastMarketCloseMs(now);
    expect(etWeekday(close)).toBe("Fri");
    expect(etDate(close)).toBe("2026-07-03");
    expect(etHm(close)).toBe("16:30");
  });

  it("is DST-correct in winter (EST offset)", () => {
    const now = Date.UTC(2026, 0, 6, 12, 0); // Tue Jan 6 2026, ~7am ET (EST, UTC-5)
    const close = lastMarketCloseMs(now);
    expect(etWeekday(close)).toBe("Mon");
    expect(etDate(close)).toBe("2026-01-05");
    expect(etHm(close)).toBe("16:30");
  });
});
