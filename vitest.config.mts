import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    /*
     * The default suite is deterministic and offline. Tests that call OpenAI
     * live in tests/model/ and run via `npm run test:model`.
     */
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/model/**", "node_modules/**"],
  },
});
