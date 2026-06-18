// RAG "ask your graph" prompt — pure + testable. The route embeds the question, retrieves nodes via
// the match_nodes pgvector RPC, and feeds them here. The system prompt enforces the no-fabrication
// guardrail (answer ONLY from retrieved context, cite node ids/titles, say "I don't know" otherwise)
// AND the no-advice posture (this app surfaces information; it never recommends a trade).

export const ASK_MODEL = "anthropic/claude-sonnet-4.6"; // Gateway dot-notation

export const ASK_SYSTEM =
  "You are the STRICT research analyst for a personal stock-market knowledge graph. " +
  "Answer the user's question using ONLY the provided context entries. Cite every claim with a " +
  "markdown link to its source node, formatted EXACTLY [<title>](/node/<id>). If the context does " +
  "not contain the answer, say you don't know — never invent facts, companies, prices, tickers, or " +
  "numbers. " +
  "Be a critic, not a cheerleader: when the user states or implies a thesis, do NOT simply agree — " +
  "surface any disconfirming evidence in the context, name the strongest counter-point, and if the " +
  "supporting evidence is thin say plainly that it is weak. Calibrate your language to the evidence " +
  "('the graph shows', 'only one source notes', 'no evidence here on') and never overstate. " +
  "You aggregate and surface information only: NEVER give buy/sell/hold advice, price targets, or " +
  "recommendations — leave the investment decision to the reader. " +
  "Be concise and use plain ASCII punctuation.";

export interface AskSource {
  id: string;
  title: string;
  type: string;
  snippet: string;
}

/** Build a compact snippet from a node's data for grounding. Pure. Pulls the prose field that
 *  carries a finance node's meaning: a news `headline`, a thesis `statement`, a company/sector
 *  `description`, plus the LLM `summary`/`body`. */
export function snippetOf(data: unknown, max = 300): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const text = [pick("summary"), pick("headline"), pick("statement"), pick("description"), pick("name"), pick("body")]
    .filter(Boolean)
    .join(" — ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Build the grounded user prompt. With no sources, instructs the model to say it cannot answer. */
export function buildAskPrompt(question: string, sources: AskSource[]): string {
  if (sources.length === 0) {
    return `Question:\n${question}\n\nThere are no matching entries in the graph. Tell the user you don't have anything on this yet.`;
  }
  const context = sources
    .map((s) => `- [${s.title}](/node/${s.id}) (${s.type}): ${s.snippet}`)
    .join("\n");
  return `Question:
${question}

Context entries (cite these with [title](/node/id)):
${context}

Answer the question using ONLY these entries, with inline [title](/node/id) citations. If they don't contain the answer, say you don't know. If any entry is evidence AGAINST the premise of the question, say so explicitly.`;
}
