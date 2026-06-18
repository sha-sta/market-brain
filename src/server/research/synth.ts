import "server-only";
import { generateText } from "ai";
import { modelFor } from "@/server/normalize/model";
import type { ResearchSynthInput, ResearchSynthOutput } from "./run";

// The strict research synthesizer (Sonnet). Sourced, calibrated, mandatory bear case, NEVER advisory —
// same posture as the thesis-judge. Cites graph nodes by [title](/node/id). Emits an optional trailing
// "TRACK: <id>, <id>" line naming surfaced nodes worth following (promoted to candidates by the loop).

const SYSTEM =
  "You are the strict research analyst for a personal stock-market knowledge graph. Synthesize ONLY " +
  "from the provided findings — never invent facts, companies, prices, tickers, or numbers. Cite every " +
  "claim with [<title>](/node/<id>) using a finding's id. Be a critic: surface disconfirming evidence " +
  "and end with a one-line, plainly-stated BEAR CASE (the strongest reason the picture could be wrong). " +
  "Calibrate to the evidence; if it's thin, say so. You aggregate and surface only — NEVER give " +
  "buy/sell/hold advice, price targets, or recommendations. Plain ASCII. " +
  "After your answer, on a final line, list any finding ids genuinely worth following as: TRACK: id1, id2 " +
  "(omit the line if none).";

export async function synthesizeResearch(input: ResearchSynthInput): Promise<ResearchSynthOutput> {
  if (input.findings.length === 0) {
    return { summary: "No sources in the graph for this request yet — try a more specific prompt, or dump a note to seed it." };
  }
  const context = input.findings.map((f) => `- [${f.title}](/node/${f.id}) (${f.type}): ${f.snippet}`).join("\n");
  const res = await generateText({
    model: modelFor("synthesis"),
    system: SYSTEM,
    prompt: `Research request: ${input.prompt}\n\nFindings (cite these):\n${context}\n\nWrite the sourced synthesis with a bear case.`,
  });
  const text = res.text.trim();
  const trackMatch = text.match(/^TRACK:\s*(.+)$/im);
  const trackNodeIds = trackMatch
    ? trackMatch[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  // Strip ALL TRACK lines (global) so a stray second one never leaks into the shown summary.
  const summary = text.replace(/^TRACK:\s*.+$/gim, "").trim();
  return { summary, trackNodeIds };
}
