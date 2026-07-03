import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@demoforge/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@demoforge/browser": resolve(__dirname, "packages/browser/src/index.ts"),
      "@demoforge/cli": resolve(__dirname, "packages/cli/src/index.ts"),
      "@demoforge/renderer": resolve(__dirname, "packages/renderer/src/index.ts"),
      "@demoforge/site": resolve(__dirname, "packages/site/src/index.ts"),
      "@demoforge/test-utils": resolve(__dirname, "packages/test-utils/src/index.ts"),
    },
  },
  test: {
    globals: false,
    passWithNoTests: true,
    include: ["packages/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/",
      "dist/",
      "**/e2e/**",
      "**/integration/**",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.spec.ts",
      ],
    },
  },
});
