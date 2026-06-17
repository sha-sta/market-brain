import { describe, it, expect } from "vitest";
import {
  canonicalizeUrl,
  comparisonKey,
  extractHardKeys,
  findDuplicate,
  normAccession,
  normCik,
  normTicker,
} from "@/server/normalize/dedupe";

describe("ticker normalization (the company hard key)", () => {
  it("uppercases and strips an exchange prefix + $", () => {
    expect(normTicker("nvda")).toBe("NVDA");
    expect(normTicker("NASDAQ:NVDA")).toBe("NVDA");
    expect(normTicker("NYSE: TSM")).toBe("TSM");
    expect(normTicker("$ionq")).toBe("IONQ");
    expect(normTicker("BRK.B")).toBe("BRK.B");
  });
  it("rejects anything that isn't ticker-shaped (never fabricate)", () => {
    expect(normTicker("")).toBe("");
    expect(normTicker("a full company name")).toBe("");
    expect(normTicker(null)).toBe("");
  });
});

describe("CIK + accession normalization", () => {
  it("strips leading zeros from a CIK", () => {
    expect(normCik("0001045810")).toBe("1045810");
    expect(normCik("CIK 0000320193")).toBe("320193");
    expect(normCik("")).toBe("");
  });
  it("reduces an accession to digits", () => {
    expect(normAccession("0001045810-24-000123")).toBe("000104581024000123");
  });
});

describe("URL canonicalization (free cross-source dedup)", () => {
  it("lowercases host, drops www/fragment/tracking params, drops trailing slash", () => {
    expect(canonicalizeUrl("https://www.Reuters.com/tech/nvidia-x/?utm_source=a&utm_medium=b#top")).toBe(
      "https://reuters.com/tech/nvidia-x",
    );
  });
  it("collapses the same article shared with different tracking params", () => {
    const a = canonicalizeUrl("https://reuters.com/a?utm_campaign=x");
    const b = canonicalizeUrl("https://www.reuters.com/a/");
    expect(a).toBe(b);
  });
  it("keeps meaningful query params", () => {
    expect(canonicalizeUrl("https://example.com/news?id=5&utm_source=x")).toBe("https://example.com/news?id=5");
  });
});

describe("extractHardKeys is type-scoped", () => {
  it("reads ticker/cik for company, url for news, accession+url for filing", () => {
    expect(extractHardKeys("company", { ticker: "nvda", cik: "0001045810" })).toEqual({
      ticker: "NVDA",
      cik: "1045810",
    });
    expect(extractHardKeys("news", { url: "https://x.com/a?utm_source=y" })).toEqual({ url: "https://x.com/a" });
    expect(extractHardKeys("filing", { accession: "0001-24-9", url: "https://sec.gov/f" })).toEqual({
      accession: "0001249",
      url: "https://sec.gov/f",
    });
    // person/sector/theme/thesis have no hard key — fuzzy only.
    expect(extractHardKeys("person", { name: "Jensen Huang" })).toEqual({});
  });
});

describe("comparisonKey", () => {
  it("keys news on headline + date, thesis on statement", () => {
    expect(comparisonKey("news", { headline: "NVIDIA beats", published_at: "2026-06-17T12:00:00Z" })).toBe(
      "nvidia beats 2026-06-17",
    );
    expect(comparisonKey("thesis", { statement: "Quantum is a decade out" })).toBe("quantum is a decade out");
  });
});

describe("findDuplicate — hard keys override and block", () => {
  const company = (id: string, name: string, ticker?: string) => ({
    id,
    type: "company",
    fields: { name, ...(ticker ? { ticker } : {}) },
  });

  it("a ticker MATCH overrides name difference", () => {
    const existing = [company("nutanix", "Nutanix", "NVDA")]; // contrived same ticker
    const r = findDuplicate(existing, "company", { name: "NVIDIA", ticker: "NVDA" });
    expect(r.verdict).toBe("match");
    expect(r.best?.id).toBe("nutanix");
  });

  it("a ticker CONFLICT blocks a merge even with identical names", () => {
    const existing = [company("tesla", "Tesla", "TSLA")];
    const r = findDuplicate(existing, "company", { name: "Tesla", ticker: "TSM" });
    expect(r.verdict).toBe("none");
    expect(r.best).toBeNull();
  });

  it("falls back to name fuzz when no ticker is present", () => {
    const existing = [company("nvidia", "NVIDIA Corporation")];
    // Without a hard key, a close-but-not-identical name lands match-or-ambiguous (the safe band: a
    // borderline name is queued for review / promoted by the vector boost, never silently dropped).
    const r = findDuplicate(existing, "company", { name: "NVIDIA Corp" });
    expect(r.best?.id).toBe("nvidia");
    expect(r.verdict).not.toBe("none");
  });

  it("news dedups by canonical url; distinct urls stay separate", () => {
    const existing = [
      { id: "n1", type: "news", fields: { headline: "NVIDIA beats", published_at: "2026-06-17", url: "https://reuters.com/a" } },
    ];
    const same = findDuplicate(existing, "news", {
      headline: "NVIDIA beats",
      published_at: "2026-06-17",
      url: "https://www.reuters.com/a/?utm_source=x",
    });
    expect(same.verdict).toBe("match");

    const other = findDuplicate(existing, "news", {
      headline: "NVIDIA beats",
      published_at: "2026-06-17",
      url: "https://bloomberg.com/b",
    });
    expect(other.verdict).toBe("none"); // different source article — never wrongly merged
  });
});
