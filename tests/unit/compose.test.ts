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

  it("escapes the LLM intro before inserting it into the brief HTML (dangerouslySetInnerHTML guard)", async () => {
    const { html } = await composeBrief(base, { summarize: async () => "<script>steal()</script>" });
    expect(html).not.toContain("<script>steal()");
    expect(html).toContain("&lt;script&gt;steal()");
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

  it("never renders a non-http(s) URL as a clickable href (XSS guard on external feed urls)", async () => {
    const { html } = await composeBrief({
      ...base,
      news: [
        { headline: "evil", url: "javascript:alert(document.cookie)", source: null, sentiment: null, materiality: null, mentions: [] },
        { headline: "ok story", url: "https://reuters.com/x", source: null, sentiment: null, materiality: null, mentions: [] },
      ],
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain("evil"); // still shown, as plain text
    expect(html).toContain('href="https://reuters.com/x"'); // legit link preserved
  });

  it("renders thesis check-ins with strength + bear case, and counts them as updates", async () => {
    const { subject, html } = await composeBrief({
      ...base,
      thesisChecks: [
        { nodeId: "t1", title: "NVDA dominates AI", strength: "contested", bearCase: "Export controls cap the China TAM.", confirming: 1, challenging: 1 },
      ],
    });
    expect(subject).toBe("MarketBrain · 2026-06-17 · 1 update on your names"); // not a quiet day
    expect(html).toContain("Thesis check-ins");
    expect(html).toContain("contested");
    expect(html).toContain("Export controls cap the China TAM.");
    expect(html).toContain("(1 for / 1 against)");
  });

  it("escapes thesis bear-case text (no HTML injection from model output)", async () => {
    const { html } = await composeBrief({
      ...base,
      thesisChecks: [{ nodeId: "t1", title: "X", strength: "weak", bearCase: "<img src=x onerror=alert(1)>", confirming: 0, challenging: 0 }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
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
