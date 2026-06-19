import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EntityEnricher, EntityEnrichSummary } from "@/server/normalize/worker";
import { normTicker } from "@/server/normalize/dedupe";
import { writeNodeData } from "@/server/normalize/upsert";
import { reportError } from "@/lib/observability";
import type { MarketDeps } from "./types";

// Ground a company node's identity in real market data (FMP/Finnhub profile) — fill cik/exchange/
// website that the LLM left blank, so identity comes from DATA, not the model. This is the finance
// analogue of brain's enrichAuthors (which grounded authorship in OpenAlex). Idempotent via a
// `market_provenance` marker; never throws (per-entity failure must not fail the doc); private
// companies are skipped (no quote/profile API). NEVER overwrites a verbatim value the LLM provided,
// and NEVER writes a raw sector label into the `sector` [[wikilink]] field.

type Client = SupabaseClient<Database>;
type Embed = (text: string) => Promise<number[]>;

function empty(nodeId: string, skipped: EntityEnrichSummary["skipped"]): EntityEnrichSummary {
  return { nodeId, enriched: false, fieldsFilled: [], skipped };
}

export function makeFinanceEnricher(supabase: Client, market: MarketDeps, embed?: Embed): EntityEnricher {
  return async (nodeId, graphId, sourceUploadId) => {
    try {
      const { data: row } = await supabase
        .from("nodes")
        .select("id, type, title, data")
        .eq("graph_id", graphId)
        .eq("id", nodeId)
        .maybeSingle();
      if (!row || row.type !== "company") return empty(nodeId, "not-a-company");

      const data = (row.data ?? {}) as Record<string, unknown>;
      const prior = { type: "company" as const, title: row.title ?? "", data };
      if (data.is_public === false) return empty(nodeId, "private"); // no quote/profile API for private cos
      if (data.market_provenance) return empty(nodeId, "already-grounded");

      const ticker = normTicker(data.ticker);
      if (!ticker) return empty(nodeId, "not-found"); // nothing verbatim to ground on — never guess one

      const profile = await market.profile(ticker);
      if (!profile) {
        // Negative marker so we don't re-hit the API every run; a later run with more data can't retry
        // unless the marker is cleared, which is fine for a quiet name.
        await writeNodeData(
          supabase,
          graphId,
          nodeId,
          { data: { ...data, market_provenance: { source: "market", ticker, matched: false, enriched_at: new Date().toISOString() } } },
          { embed, prior, reason: "enrich", sourceUploadId },
        );
        return empty(nodeId, "not-found");
      }

      const filled: string[] = [];
      const patch: Record<string, unknown> = { ...data };
      if (!data.cik && profile.cik) {
        patch.cik = profile.cik;
        filled.push("cik");
      }
      if (!data.exchange && profile.exchange) {
        patch.exchange = profile.exchange;
        filled.push("exchange");
      }
      if (!data.website && profile.website) {
        patch.website = profile.website;
        filled.push("website");
      }
      patch.market_provenance = { source: "market", ticker, matched: true, enriched_at: new Date().toISOString() };
      await writeNodeData(supabase, graphId, nodeId, { data: patch }, { embed, prior, reason: "enrich", sourceUploadId });
      return { nodeId, enriched: filled.length > 0, fieldsFilled: filled, skipped: null };
    } catch (e) {
      reportError(e, { scope: "makeFinanceEnricher", nodeId });
      return empty(nodeId, null);
    }
  };
}
