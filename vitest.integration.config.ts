import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@demoforge/core": resolve(__dirname, "packages/core/dist/index.js"),
      "@demoforge/browser": resolve(__dirname, "packages/browser/dist/index.js"),
      "@demoforge/cli": resolve(__dirname, "packages/cli/dist/index.js"),
      "@demoforge/renderer": resolve(__dirname, "packages/renderer/dist/index.js"),
      "@demoforge/site": resolve(__dirname, "packages/site/dist/index.js"),
      "@demoforge/studio": resolve(__dirname, "packages/studio/dist/index.js"),
      "@demoforge/test-utils": resolve(__dirname, "packages/test-utils/dist/index.js"),
    },
  },
  test: {
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
