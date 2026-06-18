import "server-only";
import { generateText } from "ai";
import { modelFor } from "@/server/normalize/model";
import { JUDGE_SYSTEM, buildJudgePrompt, judgeOutputSchema } from "./thesis-prompt";
import type { Judge } from "./thesis-judge";

// The live Sonnet judge. generateText + JSON.parse + lenient zod (same discipline as the extractor —
// not generateObject), so a fumbled field degrades instead of throwing. Requires AI_GATEWAY_API_KEY;
// callers only construct this when the key is present.

/** Pull the first JSON object out of model text (tolerates ```json fences / stray prose). */
function parseJsonObject(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("judge returned no JSON object");
  return JSON.parse(fenced.slice(start, end + 1));
}

export function liveJudge(): Judge {
  return async (input) => {
    const res = await generateText({
      model: modelFor("critic"),
      system: JUDGE_SYSTEM,
      prompt: buildJudgePrompt(input),
    });
    return judgeOutputSchema.parse(parseJsonObject(res.text));
  };
}
