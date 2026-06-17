// Shared multi-graph constants. NOT `import "server-only"` so modules that integration tests import
// directly (e.g. src/server/ingest/ingest.ts) can use them without pulling in the server-only DAL.

/** Fixed sentinel id of the default "Main" graph (seeded in migration 0023). The fallback active graph
 *  when no graph is otherwise resolved (a brand-new profile, or an API key whose owner has none). */
export const MAIN_GRAPH_ID = "00000000-0000-0000-0000-0000000000aa";
