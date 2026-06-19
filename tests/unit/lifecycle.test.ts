import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideSupersede,
  asOfFromData,
  decayWindow,
  archiveCutoffMs,
  tierOf,
  type PermanenceTier,
} from "@/server/normalize/lifecycle";

const T0 = Date.UTC(2026, 0, 1); // older
const T1 = Date.UTC(2026, 5, 1); // newer
const DAY = 86_400_000;

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

describe("decayWindow — tiered retention", () => {
  it("gives news a short ephemeral floor", () => {
    expect(decayWindow("news", "ephemeral")).toEqual({ archiveDays: 7, deleteDays: 21 });
  });

  it("never deletes a landmark news node or any filing tier", () => {
    expect(decayWindow("news", "landmark").deleteDays).toBeNull();
    for (const t of ["ephemeral", "routine", "notable", "landmark"] as PermanenceTier[]) {
      expect(decayWindow("filing", t).deleteDays).toBeNull();
    }
  });

  it("never decays note, thesis, or structural types", () => {
    for (const type of ["note", "thesis", "company", "person", "sector", "theme", "risk", "macro_factor"]) {
      expect(decayWindow(type, "ephemeral")).toEqual({ archiveDays: null, deleteDays: null });
    }
  });

  it("falls back to the conservative 'notable' default when the tier is missing — never the aggressive floor", () => {
    expect(decayWindow("news", null)).toEqual(decayWindow("news", "notable"));
    expect(decayWindow("news", null)).not.toEqual(decayWindow("news", "ephemeral"));
    // and via archiveCutoffMs: an untiered news node uses the notable archive window (90d), not 7d
    const now = Date.UTC(2027, 0, 1);
    expect(archiveCutoffMs("news", {}, now)).toBe(now - 90 * DAY);
  });

  it("keeps a >=7 day grace between archive and delete for every deletable (type, tier)", () => {
    for (const type of ["news", "catalyst", "signal"]) {
      for (const tier of ["ephemeral", "routine", "notable", "landmark"] as PermanenceTier[]) {
        const { archiveDays, deleteDays } = decayWindow(type, tier);
        if (deleteDays == null) continue; // never-delete tiers are exempt
        expect(archiveDays).not.toBeNull();
        expect(deleteDays - (archiveDays as number)).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe("tierOf — reads data._tier safely", () => {
  it("returns a valid tier, else null", () => {
    expect(tierOf({ _tier: "landmark" })).toBe("landmark");
    expect(tierOf({ _tier: "bogus" })).toBeNull();
    expect(tierOf({})).toBeNull();
  });
});

describe("prune_archived_nodes SQL mirrors decayWindow() (sync-guard)", () => {
  function loadPruneSql(): string {
    const migDir = resolve(process.cwd(), "supabase/migrations");
    const file = readdirSync(migDir)
      .filter((f) => /prune_archived_nodes.*\.sql$/i.test(f))
      .sort()
      .pop();
    if (!file) throw new Error("no *_prune_archived_nodes*.sql migration found");
    return readFileSync(resolve(migDir, file), "utf8");
  }

  it("declares a (type,tier,ddays) tuple for every deletable window in decayWindow()", () => {
    const sql = loadPruneSql();
    for (const type of ["news", "catalyst", "signal"]) {
      for (const tier of ["ephemeral", "routine", "notable"] as PermanenceTier[]) {
        const ddays = decayWindow(type, tier).deleteDays;
        expect(ddays).not.toBeNull(); // these three tiers are all deletable
        // the SQL `values` table must carry exactly this tuple, e.g. ('news','ephemeral',21)
        const tuple = new RegExp(`\\('${type}','${tier}',${ddays}\\)`);
        expect(sql).toMatch(tuple);
      }
    }
  });

  it("excludes filings from the eligible set (never hard-deleted) and treats landmark as never-delete", () => {
    const sql = loadPruneSql();
    expect(sql).toMatch(/n\.type in \('news','catalyst','signal'\)/); // filing not eligible
    expect(decayWindow("news", "landmark").deleteDays).toBeNull();
    expect(sql).toMatch(/landmark/); // the SQL explicitly resolves landmark to a null (never) window
  });
});
