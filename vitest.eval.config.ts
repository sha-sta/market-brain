import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Grounding-eval project. Reuses the integration wiring (server-only stub + `@` alias) but is NOT part
// of the normal test globs — `test`/`test:integration` scan tests/unit + tests/integration only, so CI
// never runs this and never needs the AI Gateway.
//
// Env: load the TEST-DB creds FIRST (.env.test.local: local SUPABASE_URL + local demo service-role key),
// then ADD the feature keys from .env.local (AI_GATEWAY_API_KEY, FINNHUB_API_KEY, SEC_EDGAR_UA) with
// override:false so .env.local's PROD NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY can NEVER
// clobber the local ones. All DB access flows through _helpers.adminClient() (reads SUPABASE_URL), and
// cleanupAll() hard-refuses any non-localhost URL — so the eval physically cannot touch prod data.
config({ path: ".env.test.local" });
config({ path: ".env.local", override: false });

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/_stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/eval/**/*.eval.ts"],
    globals: false,
    // Live LLM extraction over ~40 docs + a per-fact LLM judge — generous ceilings.
    testTimeout: 1_800_000, // 30 min
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
