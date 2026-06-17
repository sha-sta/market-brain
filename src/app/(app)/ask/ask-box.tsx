"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { segmentAnswer } from "./citations";

// Streams the grounded answer from /api/ask via a plain fetch + ReadableStream reader (no extra
// deps). Inline [title](/node/id) citations are linkified ONLY for ids that were actually retrieved
// (sent back in the x-ask-source-ids header); unknown ids render as plain text.

export function AskBox() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [validIds, setValidIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setValidIds(new Set());
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      if (!res.ok || !res.body) {
        setError(res.status === 400 ? "Ask a question first." : "Something went wrong. Try again.");
        return;
      }
      setValidIds(new Set((res.headers.get("x-ask-source-ids") ?? "").split(",").filter(Boolean)));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAnswer(acc);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <form onSubmit={ask} className="mb-6 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What did we conclude about…?"
          className="w-full rounded-md border border-border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {answer && (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {segmentAnswer(answer, validIds).map((s, i) =>
            s.kind === "cite" ? (
              <Link key={i} href={`/node/${s.id}`} className="text-blue-600 hover:underline">
                {s.title}
              </Link>
            ) : (
              <span key={i}>{s.value}</span>
            ),
          )}
        </div>
      )}
      {loading && !answer && <p className="text-sm text-muted">Searching the graph…</p>}
    </div>
  );
}
