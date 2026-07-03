/**
 * Tests for the configuration system.
 *
 * Covers: loadConfig(), initConfig(), default values, YAML parsing,
 * validation errors, and the config injection pattern (no singletons).
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ConfigError } from "../errors/index.js";

// We import the module under test. These exports won't exist yet (RED phase).
import * as configModule from "./config.js";

// --- helpers ---

/** Create a temporary directory and return its path. */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "demoforge-test-"));
}

// --- test suite ---

describe("config — RED phase (T3)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = tmpDir();
  });

  afterAll(() => {
    // Best-effort cleanup
    try {
      const tmp = os.tmpdir();
      const dirs = fs.readdirSync(tmp).filter((f) =>
        f.startsWith("demoforge-test-")
      );
      for (const d of dirs) {
        fs.rmSync(path.join(tmp, d), { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  });

  // ------------------------------------------------------------------
  // 1. loadConfig — complete YAML
  // ------------------------------------------------------------------
  describe("loadConfig()", () => {
    it("parses a complete demoforge.yaml and returns a Config object", async () => {
      const yaml = `
demo: test-complete
llm:
  base_url: http://localhost:8080
  model: llama-3.2-3b-instruct
  context_budget: 8192
render:
  viewports:
    - { width: 1440, height: 900 }
    - { width: 390, height: 844 }
  themes: [light, dark]
  locales: [en-US, es-ES]
seed:
  command: npx prisma db seed
  timeout: 30000
redaction:
  - pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b'
    label: ssn
  - pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]+'
    label: email
output:
  formats: [mp4, gif]
  budgets:
    gif: 5242880
narration:
  mode: captions
`;
      fs.writeFileSync(path.join(tmp, "demoforge.yaml"), yaml);

      const result = await configModule.loadConfig(tmp);

      expect(result.llm.base_url).toBe("http://localhost:8080");
      expect(result.llm.model).toBe("llama-3.2-3b-instruct");
      expect(result.llm.context_budget).toBe(8192);
      expect(result.render.viewports).toHaveLength(2);
      expect(result.render.themes).toEqual(["light", "dark"]);
      expect(result.render.locales).toEqual(["en-US", "es-ES"]);
      expect(result.seed.command).toBe("npx prisma db seed");
      expect(result.seed.timeout).toBe(30000);
      expect(result.redaction).toHaveLength(2);
      expect(result.redaction[0]!.label).toBe("ssn");
      expect(result.output.formats).toEqual(["mp4", "gif"]);
      expect(result.output.budgets.gif).toBe(5242880);
      expect(result.narration.mode).toBe("captions");
    });

    it("falls back to defaults when demoforge.yaml is missing", async () => {
      // tmp dir has NO demoforge.yaml
      const result = await configModule.loadConfig(tmp);

      expect(result.llm.base_url).toBe("http://localhost:8080");
      expect(result.llm.model).toBe("llama-3.2-3b-instruct");
      expect(result.llm.context_budget).toBe(4096);
      expect(result.render.viewports).toHaveLength(1);
      expect(result.render.viewports[0]!.width).toBe(1440);
      expect(result.render.viewports[0]!.height).toBe(900);
      expect(result.render.themes).toEqual(["light", "dark"]);
      expect(result.render.locales).toEqual(["en-US"]);
      expect(result.seed.command).toBeUndefined();
      expect(result.seed.timeout).toBe(30000);
      expect(result.redaction).toEqual([]);
      expect(result.output.formats).toEqual(["mp4", "webm", "gif"]);
      expect(result.output.budgets.gif).toBe(5242880);
      expect(result.narration.mode).toBe("none");
      expect(result.explorer.maxSteps).toBe(50);
      expect(result.explorer.maxTime).toBe(60000);
    });

    it("resolves demoforge.yaml from parent directories", async () => {
      const nested = path.join(tmp, "project", "sub", "deep");
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(tmp, "demoforge.yaml"), "demo: test-parent\nllm:\n  model: custom-model\n");

      const result = await configModule.loadConfig(nested);
      expect(result.llm.model).toBe("custom-model");
    });

    it("throws ConfigError on invalid YAML syntax", async () => {
      fs.writeFileSync(
        path.join(tmp, "demoforge.yaml"),
        "llm:\n  base_url: :\n    broken: [",
      );
      await expect(configModule.loadConfig(tmp)).rejects.toThrow(ConfigError);
    });

    it("throws ConfigError for missing required config field (demo name)", async () => {
      // demo name is required in the YAML top-level
      fs.writeFileSync(
        path.join(tmp, "demoforge.yaml"),
        "title: My Demo\nllm:\n  base_url: http://localhost:8080\n  model: test\n",
      );
      await expect(configModule.loadConfig(tmp)).rejects.toThrow(ConfigError);
    });
  });

  // ------------------------------------------------------------------
  // 2. initConfig — scaffold writing
  // ------------------------------------------------------------------
  describe("initConfig()", () => {
    it("writes a valid demoforge.yaml scaffold to the given directory", async () => {
      const target = path.join(tmp, "my-project");
      fs.mkdirSync(target, { recursive: true });

      await configModule.initConfig(target);

      const configPath = path.join(target, "demoforge.yaml");
      expect(fs.existsSync(configPath)).toBe(true);

      // Re-parse to verify it's valid
      const result = await configModule.loadConfig(target);
      expect(result.llm.base_url).toBe("http://localhost:8080");
      expect(result.llm.model).toBe("llama-3.2-3b-instruct");
    });

    it("does not overwrite an existing demoforge.yaml", async () => {
      const target = path.join(tmp, "my-project");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(
        path.join(target, "demoforge.yaml"),
        "demo: existing\n",
      );

      await configModule.initConfig(target);

      const content = fs.readFileSync(path.join(target, "demoforge.yaml"), "utf-8");
      expect(content).toContain("demo: existing");
    });
  });

  // ------------------------------------------------------------------
  // 3. Config injection pattern — no global singletons
  // ------------------------------------------------------------------
  describe("config injection pattern", () => {
    it("loadConfig returns a fresh object each call (no shared reference)", async () => {
      const dir = path.join(tmp, "inject-test");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "demoforge.yaml"),
        "demo: inject-test\nllm:\n  base_url: http://localhost:8080\n  model: test\n",
      );

      const a = await configModule.loadConfig(dir);
      const b = await configModule.loadConfig(dir);

      expect(a).not.toBe(b);
      // Mutating one doesn't affect the other
      a.llm.model = "mutated";
      expect(b.llm.model).toBe("test");
    });

    it("config is passed as function parameter, not read via global", async () => {
      // Verify no global singleton exists on globalThis
      // This is a static-check style test — we assert the module
      // does not export any global state variable.
      expect((globalThis as Record<string, unknown>)["_demoforgeConfig"]).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // 4. Default values
  // ------------------------------------------------------------------
  describe("default values", () => {
    it("applies all documented defaults when config is minimal", async () => {
      fs.writeFileSync(
        path.join(tmp, "demoforge.yaml"),
        "demo: defaults-test\n",
      );
      const result = await configModule.loadConfig(tmp);

      expect(result.llm.base_url).toBe("http://localhost:8080");
      expect(result.llm.model).toBe("llama-3.2-3b-instruct");
      expect(result.llm.context_budget).toBe(4096);
      expect(result.narration.mode).toBe("none");
      expect(result.render.viewports).toEqual([{ width: 1440, height: 900 }]);
      expect(result.render.themes).toEqual(["light", "dark"]);
      expect(result.render.locales).toEqual(["en-US"]);
      expect(result.seed.command).toBeUndefined();
      expect(result.seed.timeout).toBe(30000);
      expect(result.redaction).toEqual([]);
      expect(result.output.formats).toEqual(["mp4", "webm", "gif"]);
      expect(result.output.budgets.gif).toBe(5242880);
      expect(result.output.budgets.mp4).toBeUndefined();
      expect(result.output.budgets.webm).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // 5. Explorer / Guardrails config
  // ------------------------------------------------------------------
  describe("explorer guardrails config", () => {
    it("parses explorer config with guardrails from demoforge.yaml", async () => {
      const yaml = `demo: explorer-test
llm:
  base_url: http://localhost:8080
  model: test
explorer:
  maxSteps: 25
  maxTime: 120000
  guardrails:
    allowedOrigins:
      - https://example.com
      - https://app.example.com
    destructiveButtonPatterns:
      - delete account
      - reset database
    destructiveUrlPatterns:
      - /admin/delete
      - /api/wipe
`;
      fs.writeFileSync(path.join(tmp, "demoforge.yaml"), yaml);
      const result = await configModule.loadConfig(tmp);

      expect(result.explorer.maxSteps).toBe(25);
      expect(result.explorer.maxTime).toBe(120000);
      expect(result.explorer.guardrails!.allowedOrigins).toEqual([
        "https://example.com",
        "https://app.example.com",
      ]);
      expect(result.explorer.guardrails!.destructiveButtonPatterns).toEqual([
        "delete account",
        "reset database",
      ]);
      expect(result.explorer.guardrails!.destructiveUrlPatterns).toEqual([
        "/admin/delete",
        "/api/wipe",
      ]);
    });
  });
});
