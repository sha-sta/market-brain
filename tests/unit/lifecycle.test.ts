import { describe, it, expect } from "vitest";
import {
  decideSupersede,
  asOfFromData,
  newsArchiveCutoffMs,
  NEWS_ARCHIVE_DAYS,
  NEWS_ARCHIVE_DAYS_HIGH,
} from "@/server/normalize/lifecycle";

const T0 = Date.UTC(2026, 0, 1); // older
const T1 = Date.UTC(2026, 5, 1); // newer

describe("decideSupersede — swap old for new, safely", () => {
  it("overwrites a narrative field when the incoming source is newer", () => {
    expect(decideSupersede("summary", T0, T1)).toBe(true);
    expect(decideSupersede("current_reading", T0, T1)).toBe(true);
  });

  it("does NOT overwrite a narrative field when the incoming source is older or equal", () => {
    expect(decideSupersede("summary", T1, T0)).toBe(false);
    expect(decideSupersede("summary", T1, T1)).toBe(false);
  });

  it("NEVER supersedes an identity/hard-key field, even when newer", () => {
    expect(decideSupersede("ticker", T0, T1)).toBe(false);
    expect(decideSupersede("cik", T0, T1)).toBe(false);
    expect(decideSupersede("name", T0, T1)).toBe(false);
  });

  it("does not supersede a non-narrative, non-identity field (e.g. website)", () => {
    expect(decideSupersede("website", T0, T1)).toBe(false);
  });

  it("requires incoming provenance; an undated incoming never supersedes", () => {
    expect(decideSupersede("summary", T0, null)).toBe(false);
  });

  it("lets a dated incoming win over an undated existing fact", () => {
    expect(decideSupersede("summary", null, T1)).toBe(true);
  });
});

describe("asOfFromData — source date drives freshness", () => {
  it("prefers a source-dated field over the fallback", () => {
    expect(asOfFromData({ published_at: "2026-06-01T00:00:00Z" }, 999)).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(asOfFromData({ filed_at: "2026-03-15" }, 999)).toBe(Date.parse("2026-03-15"));
  });

  it("falls back to write time when no/invalid source date", () => {
    expect(asOfFromData({}, 42)).toBe(42);
    expect(asOfFromData({ published_at: "not a date" }, 42)).toBe(42);
  });
});

describe("newsArchiveCutoffMs — materiality extends the window", () => {
  const now = Date.UTC(2027, 0, 1);
  it("uses the long window for high-materiality news", () => {
    expect(now - newsArchiveCutoffMs("high", now)).toBe(NEWS_ARCHIVE_DAYS_HIGH * 86_400_000);
  });
  it("uses the default window otherwise", () => {
    expect(now - newsArchiveCutoffMs("med", now)).toBe(NEWS_ARCHIVE_DAYS * 86_400_000);
    expect(now - newsArchiveCutoffMs(undefined, now)).toBe(NEWS_ARCHIVE_DAYS * 86_400_000);
  });
});
