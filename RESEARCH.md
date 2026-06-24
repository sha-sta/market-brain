# MarketBrain: how it compares

MarketBrain is a personal, self-maintaining knowledge graph for stock-market research. A daily cron grows the graph from live price, news, and filing feeds, keeps it small by decaying and pruning what no longer matters, corrects facts when sources change, and produces a strict, non-advisory morning brief. It runs on a single Supabase free tier with one daily cron.

This document compares MarketBrain's design choices to similar tools, with citations.

## Comparison

| Dimension | MarketBrain | Graphiti / Zep | Microsoft GraphRAG | Perplexity Finance |
|---|---|---|---|---|
| **Storage / stack** | Postgres + pgvector only (Supabase free tier, RLS, one cron) | Requires a graph DB (Neo4j 5.26+, FalkorDB, Neptune, or Kuzu); no Postgres driver | Parquet files on disk (a built artifact; pluggable blob/Cosmos) | Hosted SaaS Q&A layer; stateless per query |
| **Auto-updates from live data** | Yes: a daily cron fetches price/news/filings and extracts them into the graph | Ingest-driven, but general agent memory with no finance feed | Batch re-index from a corpus; incremental update is append-only ([issue #741](https://github.com/microsoft/graphrag/issues/741)) | Pulls live web/filings per query, but keeps no persistent personal graph |
| **Lifecycle / prunes to reclaim storage** | Tiered archive, then reference-guarded hard-delete that reclaims the row + embedding and never deletes live-thesis evidence | Invalidate-only by design; never deletes rows, favoring "historical completeness over storage optimization" ([blog](https://blog.getzep.com/beyond-static-knowledge-graphs/)) | None; the graph only grows, and stale removal means a full re-index | None; no persistent store |
| **Evidence-gated / verbatim claims** | An edge is `assertable` only if it is a strong relation, confidence is at least 0.8, and its `evidence_quote` verifies as an NFC-normalized verbatim substring of the source | Trusts LLM extraction; hybrid retrieval is its strength, not source-verbatim gating | Claims are LLM-asserted, not substring-verified | Sentence-level citations by convention, with no verbatim pass/fail gate |
| **Non-advisory, self-demoting critic** | A hard invariant bans all buy/sell/hold/price-target vocabulary; the critic stress-tests the user's own thesis and `enforceFloor()` can only lower the verdict toward verified evidence | None; general-purpose memory | None; domain-agnostic | Non-advisory by disclaimer, not an enforced invariant; no thesis critic |
| **Domain** | Personal stock-market research brain | General agent memory | Domain-agnostic | Finance, but a search/Q&A product |

## Design choices and the closest existing work

Each design choice below is listed with the closest existing work, for reference.

- **Self-updating, fact-reconciling memory.** When a source states that a fact on a permanent node changed (a CEO leaves, a company renames), the extractor emits a correction that rides the same extraction call, so reconciliation costs no extra LLM pass. High-confidence, verbatim-verified changes auto-apply; mid-confidence ones queue for review; identity fields are protected (a rename appends `former_name`/`aliases` and never overwrites the dedupe key). [Mem0](https://docs.mem0.ai/core-concepts/memory-operations/update) provides a comparable extract-then-reconcile loop on the same Postgres + pgvector stack.

- **Reference-guarded prune (hard-delete).** Stale news/catalyst/signal nodes are archived and then hard-deleted to reclaim the row and its embedding under a fixed storage budget, but never if the node is still backing a live thesis or an active tracked entity. Most agent-memory systems invalidate rather than delete ([Graphiti](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)), and frameworks that delete ([Mem0](https://docs.mem0.ai/core-concepts/memory-operations/update)) do not guard against removing something still referenced. The guard here is domain-semantic (live-thesis evidence), not a generic foreign-key constraint.

- **Evidence-gated claims.** A relation becomes assertable only if its quote checks out word-for-word against the source text. Verbatim-or-invalid quoting is an established technique ([Deterministic Quoting](https://mattyyeung.github.io/deterministic-quoting)), applied here as a hard gate on a typed, persistent graph edge.

- **Deterministic, demote-only verdict floor.** The thesis critic's final verdict is computed by code, not the model: `enforceFloor()` can only lower confidence toward what the verified evidence supports, never raise it. Code-decided verdicts are the design behind evaluation frameworks such as [DeepEval's DAG metric](https://deepeval.com/docs/metrics-dag).

- **Non-advisory adversarial critic.** The critic argues against the user's own thesis and never emits buy/sell/hold or price-target language (a hard, test-enforced rule). The "devil's advocate on your own thesis" pattern also appears in the open-source [devilsadvocate](https://github.com/unicodeveloper/devilsadvocate) and in [LinqAlpha](https://aws.amazon.com/blogs/machine-learning/how-linqalpha-assesses-investment-theses-using-devils-advocate-on-amazon-bedrock/).

- **Cross-layer build-failing invariants.** The assertable vocabulary is kept identical across a SQL generated column, a TypeScript constant, and a runtime check, and the decay windows are kept identical across SQL and TypeScript, with unit tests that parse the raw migration text and fail the build on any drift.

## Why not an off-the-shelf framework (Graphiti / GraphRAG)?

[Graphiti/Zep](https://github.com/getzep/graphiti) is a widely used temporal knowledge-graph memory framework, but it does not fit two of MarketBrain's requirements:

1. **It requires a graph database.** Neo4j, FalkorDB, Neptune, or the deprecated Kuzu, with no Postgres/pgvector driver. MarketBrain runs on one Supabase free tier; Graphiti would mean operating a separate graph-DB server. The [Community Edition was discontinued in April 2025](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/), and Zep Cloud is credit-metered.

2. **It is invalidate-only by design.** Graphiti is bi-temporal and never deletes rows, favoring [historical completeness over storage optimization](https://blog.getzep.com/beyond-static-knowledge-graphs/). MarketBrain's reference-guarded hard-delete reclaims space under a fixed budget.

The document-corpus builders differ as well: [GraphRAG](https://microsoft.github.io/graphrag/index/architecture/) produces an append-only batch artifact, [LlamaIndex's PropertyGraphIndex](https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/) provides upsert/delete primitives but no lifecycle policy, and [Cognee](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory) prunes at dataset granularity rather than per-node with a reference guard. MarketBrain uses a custom Postgres-native implementation to fit its constraints.

## Who it's for

- A single investor who tracks a watchlist of names and industries and wants research that maintains itself: the graph grows from a daily feed, drops what no longer matters, corrects facts when sources change, and produces a strict daily brief.
- Readers who want evidence rather than advice: the non-advisory rule, the verbatim-evidence gate, and the adversarial critic test a thesis against source-grounded facts and leave the decision to the reader. It does not produce buy/sell signals or analyst ratings.
