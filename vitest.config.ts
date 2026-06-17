import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit project: pure functions only (no DB, no network). Fast, runs in CI on every push.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
  },
});
