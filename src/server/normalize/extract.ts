import "server-only";
import { generateText } from "ai";
import { extractEnvelopeSchema } from "./extract-schema";
import { SYSTEM, buildStaticPrefix, buildDynamicTail, type ExistingEntity } from "./prompt";
import { pickModel } from "./model";
import { extractUsage } from "./usage";
import type { ExtractResult } from "./worker";

// Live entity extraction via the Vercel AI Gateway (Claude). Uses generateText + JSON parse (NOT
// generateObject): our `frontmatter` is an open record, and structured-output mode fills open
// objects empty — letting the prompt drive field population is how the Python build did it.
// Model escalates haiku->sonnet on retry or large input. Requires AI_GATEWAY_API_KEY.
//
// The prompt is sent as two parts so the large static prefix (rules + field spec + worked example)
// can be cached: the prefix part carries an Anthropic ephemeral cache_control breakpoint, so Claude
// re-uses it across chunks (~90% off the repeated input tokens). The dynamic tail — raw chunk, retry
// errors, and #8 existing-entity hints — sits after the breakpoint and is never cached.

function parseJson(text: string): unknown {
  let t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1].trim();
  return JSON.parse(t);
}

export async function extractEntities(
  rawText: string,
  typeSpec: string,
  errors?: string[],
  existingEntities?: ExistingEntity[],
): Promise<ExtractResult> {
  const model = pickModel(rawText.length, Boolean(errors && errors.length));
  const result = await generateText({
    model,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildStaticPrefix(typeSpec),
            // Cache breakpoint: Claude caches everything up to here (system + this prefix) and re-uses
            // it on the next chunk. Keep this part byte-stable — never fold the chunk/hints into it.
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
          },
          { type: "text", text: buildDynamicTail(rawText, { errors, existingEntities }) },
        ],
      },
    ],
  });
  return { envelope: extractEnvelopeSchema.parse(parseJson(result.text)), usage: extractUsage(result, model) };
}
