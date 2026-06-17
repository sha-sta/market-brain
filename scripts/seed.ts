/**
 * Pre-seed dad's MarketBrain graph: theme/sector/company nodes (incl. private Anthropic + SpaceX),
 * in_theme/in_sector edges, tracked_entities (the cron's work-list), a few example positions to
 * demonstrate the portfolio, and profile promotion. Run once after `supabase db push`:
 *
 *   npm run seed
 *
 * Self-contained (no app imports) so it runs cleanly under tsx. Uses the service-role key (bypasses
 * RLS). Embeddings are computed via the AI Gateway when AI_GATEWAY_API_KEY is set (so Ask + news
 * linking work day one); without it, nodes seed with a null embedding and can be re-embedded later.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { embedMany } from "ai";

const MAIN_GRAPH_ID = "00000000-0000-0000-0000-0000000000aa";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Seed needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (set in .env.local).");
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

type NodeSeed = {
  id: string;
  type: "company" | "theme" | "sector";
  title: string;
  status: string;
  tags: string[];
  data: Record<string, unknown>;
  track?: "owned" | "watchlist" | "theme";
};

const themes: NodeSeed[] = [
  { id: "quantum-computing", type: "theme", title: "Quantum Computing", status: "active", tags: ["quantum-computing"], data: { name: "Quantum Computing", description: "Companies building quantum hardware/software." }, track: "theme" },
  { id: "artificial-intelligence", type: "theme", title: "Artificial Intelligence", status: "active", tags: ["artificial-intelligence"], data: { name: "Artificial Intelligence", description: "Frontier AI models and the compute around them." }, track: "theme" },
  { id: "aerospace", type: "theme", title: "Aerospace & Space", status: "active", tags: ["aerospace"], data: { name: "Aerospace & Space", description: "Launch, satellites, and space infrastructure." }, track: "theme" },
  { id: "semiconductors", type: "theme", title: "Semiconductors", status: "active", tags: ["semiconductor"], data: { name: "Semiconductors", description: "Chips that power AI and computing." }, track: "theme" },
  { id: "defense-tech", type: "theme", title: "Defense Tech", status: "active", tags: ["defense-tech"], data: { name: "Defense Tech", description: "Modern defense and dual-use technology." }, track: "theme" },
];

const sectors: NodeSeed[] = [
  { id: "technology", type: "sector", title: "Technology", status: "active", tags: [], data: { name: "Technology" } },
  { id: "industrials", type: "sector", title: "Industrials", status: "active", tags: [], data: { name: "Industrials" } },
];

function company(
  id: string,
  name: string,
  over: Partial<NodeSeed["data"]> & { themes?: string[]; sector?: string; track: "owned" | "watchlist" },
): NodeSeed {
  const { themes: th, sector, track, ...rest } = over;
  return {
    id,
    type: "company",
    title: name,
    status: track === "owned" ? "owned" : "watchlist",
    tags: (th ?? []).slice(0, 4),
    data: {
      name,
      is_public: true,
      ...(sector ? { sector: `[[${sector}]]` } : {}),
      ...(th ? { themes: th.map((t) => `[[${t}]]`) } : {}),
      ...rest,
    },
    track,
  };
}

const companies: NodeSeed[] = [
  // Quantum (small caps — watchlist)
  company("ionq", "IonQ", { ticker: "IONQ", exchange: "NYSE", themes: ["quantum-computing"], sector: "technology", track: "watchlist" }),
  company("rigetti", "Rigetti Computing", { ticker: "RGTI", exchange: "NASDAQ", themes: ["quantum-computing"], sector: "technology", track: "watchlist" }),
  company("d-wave", "D-Wave Quantum", { ticker: "QBTS", exchange: "NYSE", themes: ["quantum-computing"], sector: "technology", track: "watchlist" }),
  company("quantum-computing-inc", "Quantum Computing Inc", { ticker: "QUBT", exchange: "NASDAQ", themes: ["quantum-computing"], sector: "technology", track: "watchlist" }),
  company("ibm", "IBM", { ticker: "IBM", exchange: "NYSE", themes: ["quantum-computing", "artificial-intelligence"], sector: "technology", track: "watchlist" }),
  // Big tech (owned)
  company("nvidia", "NVIDIA", { ticker: "NVDA", exchange: "NASDAQ", themes: ["artificial-intelligence", "semiconductors"], sector: "technology", track: "owned" }),
  company("microsoft", "Microsoft", { ticker: "MSFT", exchange: "NASDAQ", themes: ["artificial-intelligence"], sector: "technology", track: "owned" }),
  company("alphabet", "Alphabet", { ticker: "GOOGL", exchange: "NASDAQ", themes: ["artificial-intelligence"], sector: "technology", track: "owned" }),
  company("apple", "Apple", { ticker: "AAPL", exchange: "NASDAQ", sector: "technology", track: "owned" }),
  company("amazon", "Amazon", { ticker: "AMZN", exchange: "NASDAQ", sector: "technology", track: "owned" }),
  company("meta", "Meta Platforms", { ticker: "META", exchange: "NASDAQ", themes: ["artificial-intelligence"], sector: "technology", track: "owned" }),
  // Private (no ticker/quote API — manual valuation)
  {
    id: "anthropic",
    type: "company",
    title: "Anthropic",
    status: "owned",
    tags: ["artificial-intelligence"],
    data: { name: "Anthropic", is_public: false, manual_valuation: 183_000_000_000, themes: ["[[artificial-intelligence]]"], sector: "[[technology]]", description: "Frontier AI lab (Claude). Private — valued manually." },
    track: "owned",
  },
  {
    id: "spacex",
    type: "company",
    title: "SpaceX",
    status: "owned",
    tags: ["aerospace", "defense-tech"],
    data: { name: "SpaceX", is_public: false, manual_valuation: 350_000_000_000, themes: ["[[aerospace]]", "[[defense-tech]]"], sector: "[[industrials]]", description: "Launch + Starlink. Private — valued manually unless/until a public listing." },
    track: "owned",
  },
];

const allNodes = [...themes, ...sectors, ...companies];

// Example positions (round numbers — edit to your real holdings).
const examplePositions = [
  { node_id: "nvidia", shares: 10, cost_basis: 120 },
  { node_id: "ionq", shares: 100, cost_basis: 40 },
  { node_id: "anthropic", manual_value: 25_000 },
  { node_id: "spacex", manual_value: 30_000 },
];

function embedTextFor(n: NodeSeed): string {
  return [n.title, n.data.name, n.data.description].filter((v) => typeof v === "string" && v).join(" ");
}

async function maybeEmbed(nodes: NodeSeed[]): Promise<(string | null)[]> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.warn("[seed] AI_GATEWAY_API_KEY unset — seeding with null embeddings (Ask/news-linking will be weaker until re-embedded).");
    return nodes.map(() => null);
  }
  const { embeddings } = await embedMany({ model: "openai/text-embedding-3-small", values: nodes.map(embedTextFor) });
  return embeddings.map((e) => `[${e.join(",")}]`);
}

async function main() {
  console.log(`[seed] graph ${MAIN_GRAPH_ID}`);
  await supabase.from("graphs").update({ name: "Dad's Market" }).eq("id", MAIN_GRAPH_ID);

  const vectors = await maybeEmbed(allNodes);
  for (let i = 0; i < allNodes.length; i += 1) {
    const n = allNodes[i];
    const { error } = await supabase.from("nodes").upsert(
      { id: n.id, graph_id: MAIN_GRAPH_ID, type: n.type, title: n.title, status: n.status, data: n.data, tags: n.tags, embedding: vectors[i] },
      { onConflict: "graph_id,id" },
    );
    if (error) throw new Error(`node ${n.id}: ${error.message}`);
  }
  console.log(`[seed] ${allNodes.length} nodes`);

  // Structural edges from each company's [[wikilink]] fields (in_theme / in_sector). Seeded edges
  // carry no evidence -> not assertable (correct: a structural link is navigation, not a proven fact).
  let edges = 0;
  for (const c of companies) {
    const links: Array<{ dst: string; rel: string }> = [];
    for (const t of (c.data.themes as string[] | undefined) ?? []) links.push({ dst: t.replace(/\[\[|\]\]/g, ""), rel: "in_theme" });
    const sec = typeof c.data.sector === "string" ? (c.data.sector as string).replace(/\[\[|\]\]/g, "") : null;
    if (sec) links.push({ dst: sec, rel: "in_sector" });
    for (const l of links) {
      const { error } = await supabase.rpc("upsert_edge", {
        p_graph_id: MAIN_GRAPH_ID,
        p_src_id: c.id,
        p_dst_id: l.dst,
        p_type: l.rel,
        p_relation_type: l.rel,
        p_method: "seed",
        p_confidence: 0.4,
      });
      if (!error) edges += 1;
    }
  }
  console.log(`[seed] ${edges} edges`);

  // tracked_entities — the cron's work-list.
  const tracked = allNodes
    .filter((n) => n.track)
    .map((n) => ({ graph_id: MAIN_GRAPH_ID, node_id: n.id, kind: n.track! }));
  const { error: tErr } = await supabase.from("tracked_entities").upsert(tracked, { onConflict: "graph_id,node_id" });
  if (tErr) throw new Error(`tracked_entities: ${tErr.message}`);
  console.log(`[seed] ${tracked.length} tracked entities`);

  // Example positions (idempotent-ish: clear seeded examples first so re-running doesn't duplicate).
  const exampleIds = examplePositions.map((p) => p.node_id);
  await supabase.from("positions").delete().eq("graph_id", MAIN_GRAPH_ID).in("node_id", exampleIds).eq("account", "example");
  const { error: pErr } = await supabase.from("positions").insert(
    examplePositions.map((p) => ({ graph_id: MAIN_GRAPH_ID, account: "example", ...p })),
  );
  if (pErr) console.warn(`[seed] positions: ${pErr.message}`);
  else console.log(`[seed] ${examplePositions.length} example positions (account 'example' — edit freely)`);

  // Promote profiles (best-effort — a profile only exists after that person signs in once).
  await promote(process.env.BOOTSTRAP_ADMIN_EMAIL, true);
  await promote(process.env.DIGEST_TO, false);

  console.log("[seed] done.");
}

async function promote(email: string | undefined, admin: boolean) {
  if (!email || !email.includes("@")) return;
  const { data, error } = await supabase
    .from("profiles")
    .update({ status: "active", ...(admin ? { is_admin: true } : {}), current_graph_id: MAIN_GRAPH_ID })
    .eq("email", email)
    .select("id");
  if (error) {
    console.warn(`[seed] promote ${email}: ${error.message}`);
  } else if (!data || data.length === 0) {
    console.warn(`[seed] no profile for ${email} yet — promote after they sign in once (or it auto-applies on next seed).`);
  } else {
    console.log(`[seed] promoted ${email}${admin ? " (admin)" : ""} to active`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
