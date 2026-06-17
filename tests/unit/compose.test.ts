import { describe, it, expect } from "vitest";
import { composeBrief, type BriefData } from "@/server/digest/compose";

const base: BriefData = { date: "2026-06-17", movers: [], news: [], filings: [], alerts: [], connections: [] };

describe("composeBrief", () => {
  it("renders a quiet-day brief when there is nothing material", async () => {
    const { subject, html } = await composeBrief(base);
    expect(subject).toBe("MarketBrain · 2026-06-17 · a quiet day");
    expect(html).toContain("quiet morning");
  });

  it("counts updates in the subject and renders only non-empty sections", async () => {
    const data: BriefData = {
      ...base,
      movers: [{ title: "NVIDIA", ticker: "NVDA", price: 1200, changePct: 3.2 }],
      news: [
        { headline: "NVIDIA beats", url: "https://r.com/a", source: "Reuters", sentiment: "bullish", materiality: "high", mentions: ["NVIDIA"] },
      ],
      connections: [{ entity: "TSMC", holdings: ["NVIDIA", "AMD", "Apple"] }],
    };
    const { subject, html } = await composeBrief(data);
    expect(subject).toBe("MarketBrain · 2026-06-17 · 2 updates on your names");
    expect(html).toContain("Price moves");
    expect(html).toContain("What changed on your names");
    expect(html).toContain("appears across 3 of your holdings");
    expect(html).not.toContain("Filings"); // empty section omitted
    expect(html).not.toContain("Alerts");
  });

  it("uses the injected summarizer for the intro, and falls back to template on failure", async () => {
    const ok = await composeBrief(base, { summarize: async () => "Markets were calm overnight." });
    expect(ok.html).toContain("Markets were calm overnight.");
    const fail = await composeBrief(base, {
      summarize: async () => {
        throw new Error("llm down");
      },
    });
    expect(fail.html).toContain("quiet morning"); // graceful template fallback
  });

  it("always carries the no-advice footer and never advises", async () => {
    const { html } = await composeBrief({
      ...base,
      movers: [{ title: "NVIDIA", ticker: "NVDA", price: 1200, changePct: -5 }],
    });
    expect(html).toContain("never recommends buying or selling");
    expect(html.toLowerCase()).not.toMatch(/\b(buy|sell)\s+(now|rating|recommendation)\b/);
  });
});
