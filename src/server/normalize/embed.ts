import "server-only";
import { embedMany } from "ai";

// Live embeddings via the Vercel AI Gateway (same AI_GATEWAY_API_KEY as Claude). 1536 dims ->
// nodes.embedding vector(1536). Verified by typecheck + manual live run.
const EMBED_MODEL = "openai/text-embedding-3-small";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({ model: EMBED_MODEL, values: texts });
  return embeddings;
}
