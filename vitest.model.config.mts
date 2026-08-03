import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/*
 * Behavioural tests that call the real API. Slow, costly, and inherently
 * non-deterministic — a model can phrase things differently run to run — so
 * they are deliberately kept out of `npm run test` and are not a gate for
 * `npm run build`. Run them when changing prompts.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/model/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    retry: 1,
  },
});
