import { requireActive } from "@/lib/auth";
import { AskBox } from "./ask-box";

// "Ask your graph": RAG Q&A over the market knowledge graph. Active users only (requireActive bounces
// guests). Answers are grounded in the graph with citations; the assistant surfaces information and
// never gives buy/sell advice.
export default async function AskPage() {
  await requireActive();
  return (
    <div className="p-6">
      <h1 className="mb-1 mt-2 text-xl font-semibold">Ask your graph</h1>
      <p className="mb-6 text-sm text-muted">
        Ask about your companies, themes, theses, or the news on your names. Answers are grounded in
        your graph with citations to the nodes they came from. It surfaces what you&apos;ve collected,
        it doesn&apos;t give advice.
      </p>
      <AskBox />
    </div>
  );
}
