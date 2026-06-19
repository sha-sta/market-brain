import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit project: pure functions only (no DB, no network). Fast, runs in CI on every push.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` exists only to fail a client bundle; stub it so a unit test can import a server
      // module to exercise its PURE helpers (e.g. websearch's isPublicHttpUrl / http's stripHtml).
      "server-only": fileURLToPath(new URL("./tests/_stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
  },
});
