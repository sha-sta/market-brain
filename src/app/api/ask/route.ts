import "server-only";
import { streamText } from "ai";
import { getProfile, getCurrentGraphId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { embedTexts } from "@/server/normalize/embed";
import { retrieveSources } from "@/server/ask/retrieve";
import { ASK_MODEL, ASK_SYSTEM, buildAskPrompt } from "@/server/ask/prompt";

// RAG Q&A: hybrid retrieval (pgvector ∪ FTS, RLS-enforced via the request-scoped client) -> stream
// a grounded, cited answer. Self-auths (the proxy excludes /api): active users only; uses the
// user's RLS client (never service-role) so retrieval honors row-level security. Node runtime.
export const maxDuration = 60;

export async function POST(request: Request) {
  // Self-auth with a clean 401 (not a redirect) — this is an API contract, like the cron routes.
  const profile = await getProfile();
  if (!profile || profile.status !== "active") {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  const supabase = await createClient();
  const graphId = await getCurrentGraphId();
  const sources = await retrieveSources(supabase, question, graphId, { embed: embedTexts });

  const result = streamText({
    model: ASK_MODEL,
    system: ASK_SYSTEM,
    prompt: buildAskPrompt(question, sources),
  });
  // Tell the client which node ids were actually retrieved so it only linkifies real citations
  // (the model can emit a [title](/node/id) for an id it wasn't given).
  return result.toTextStreamResponse({ headers: { "x-ask-source-ids": sources.map((s) => s.id).join(",") } });
}
