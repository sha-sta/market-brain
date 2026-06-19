import "server-only";
import { generateText } from "ai";
import { SONNET } from "@/server/normalize/model";
import type { BriefData } from "./compose";

// The optional LLM intro for the brief. Injected into composeBrief, so it's swappable/cuttable. The
// prompt is strictly NON-advisory: aggregate + surface, attribute to the data, never recommend. Keep
// it short (the deltas carry the detail). Requires AI_GATEWAY_API_KEY; the caller omits this when the
// key is absent (template-only brief).

const SYSTEM =
  "You write a 1-3 sentence intro for a personal stock-market morning brief. You ONLY summarize the " +
  "supplied facts — never add information, never give buy/sell/hold advice, price targets, or " +
  "recommendations. Be plain, factual, and calm, but do NOT be falsely reassuring: if a thesis " +
  "check-in is weak or a new risk is elevated, reflect that honestly in your tone. No markdown, no preamble.";

export async function summarizeBrief(data: BriefData): Promise<string> {
  const facts = [
    data.movers.length
      ? `Movers: ${data.movers.map((m) => `${m.title} ${m.changePct === null ? "" : m.changePct.toFixed(1) + "%"}`).join(", ")}`
      : "",
    data.news.length ? `${data.news.length} new article(s): ${data.news.map((n) => n.headline).slice(0, 6).join("; ")}` : "",
    data.connections.length
      ? `Connections: ${data.connections.map((c) => `${c.entity} across ${c.holdings.length} holdings`).join(", ")}`
      : "",
    data.thesisChecks?.length
      ? `Thesis check-ins: ${data.thesisChecks.map((t) => `${t.title} — ${t.strength}`).join("; ")}`
      : "",
    data.filings.length ? `${data.filings.length} new filing(s)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!facts) return "A quiet morning — nothing material moved on the names you follow.";

  const result = await generateText({
    model: SONNET,
    system: SYSTEM,
    prompt: `Date: ${data.date}\nFacts:\n${facts}\n\nWrite the intro.`,
  });
  return result.text.trim();
}
