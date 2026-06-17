import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Integration project: runs against the LOCAL Supabase stack (supabase start).
// Never mocks the DB schema — exercises real RLS, pgvector, and Storage.
// Requires Docker + `supabase start`; loads local keys from .env.test.local.
config({ path: ".env.test.local" });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` exists only to fail a client bundle; stub it so server IO modules (drain,
      // reprocess) can be exercised against the real DB in this node runner.
      "server-only": fileURLToPath(new URL("./tests/_stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one DB; run serially to keep RLS/seed state deterministic.
    fileParallelism: false,
  },
});
