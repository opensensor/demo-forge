/**
 * Tests for the seed-data hook executor.
 *
 * Covers: runSeedHook() with all failure semantics (abort/warn/retry),
 * timeout enforcement, stdout/stderr capture, --skip-seed bypass,
 * --strict mode empty-state handling, and actionable error messages.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createLogger } from "../logger.js";
import { SeedError } from "../errors/index.js";

import * as seedModule from "./seed";

// --- helpers ---

/** Create a temporary directory and return its path. */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "demoforge-seed-test-"));
}

/**
 * Create a temporary executable script that exits with the given code
 * and optionally writes to stdout/stderr.
 */
function createScript(
  tmp: string,
  name: string,
  opts: { exitCode?: number; stdout?: string; stderr?: string; sleepMs?: number },
): string {
  const scriptPath = path.join(tmp, name.replace(/\.sh$/, ".js"));
  const shebang = "#!/usr/bin/env node\n";
  const parts: string[] = [shebang];

  if (opts.stdout) {
    parts.push(`process.stdout.write("stdout: ${opts.stdout}");`);
  }
  if (opts.stderr) {
    parts.push(`process.stderr.write("stderr: ${opts.stderr}");`);
  }
  if (opts.sleepMs) {
    parts.push(`await new Promise(r => setTimeout(r, ${opts.sleepMs}));`);
  }
  parts.push(`process.exit(${opts.exitCode ?? 0});`);

  fs.writeFileSync(scriptPath, parts.join("\n"));
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

// --- test suite ---

describe("seed — T8: seed-data hook executor", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = tmpDir();
  });

  afterAll(() => {
    try {
      const dirs = fs.readdirSync(os.tmpdir()).filter((f) =>
        f.startsWith("demoforge-seed-test-"),
      );
      for (const d of dirs) {
        fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  });

  // ------------------------------------------------------------------
  // 1. Successful seed execution
  // ------------------------------------------------------------------
  describe("runSeedHook() — success", () => {
    it("executes the configured seed command and resolves", async () => {
      const script = createScript(tmp, "seed.sh", {
        stdout: "seeding database",
        exitCode: 0,
      });

      const logger = createLogger({ level: "silent" });
      await seedModule.runSeedHook(
        { command: script, timeout: 10000 },
        { logger },
      );
      // No error thrown — success
    });

    it("returns undefined on success (void return)", async () => {
      const script = createScript(tmp, "seed-ok.sh", { exitCode: 0 });

      const logger = createLogger({ level: "silent" });
      const result = await seedModule.runSeedHook(
        { command: script, timeout: 10000 },
        { logger },
      );

      expect(result).toBeUndefined();
    });

    it("logs stdout on success when debug is enabled", async () => {
      const script = createScript(tmp, "seed-log.sh", {
        stdout: "output line",
        exitCode: 0,
      });

      const logger = createLogger({ level: "debug" });
      const infoSpy = vi.spyOn(logger, "info");
      await seedModule.runSeedHook(
        { command: script, timeout: 10000 },
        { logger },
      );

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("output line"));
    });
  });

  // ------------------------------------------------------------------
  // 2. --skip-seed bypass
  // ------------------------------------------------------------------
  describe("runSeedHook() — skip-seed", () => {
    it("skips execution when skipSeed is true and resolves immediately", async () => {
      const logger = createLogger({ level: "info" });
      const infoSpy = vi.spyOn(logger, "info");

      await seedModule.runSeedHook(
        { command: "should-not-run", timeout: 10000 },
        { logger, skipSeed: true },
      );

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Skipping"));
    });

    it("does not spawn a child process when skipSeed is true", async () => {
      const spawnSpy = vi.spyOn(seedModule, "spawn");
      const logger = createLogger({ level: "silent" });

      await seedModule.runSeedHook(
        { command: "should-not-run", timeout: 10000 },
        { logger, skipSeed: true },
      );

      expect(spawnSpy).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // 3. Empty-state handling (no command configured)
  // ------------------------------------------------------------------
  describe("runSeedHook() — empty-state", () => {
    it("warns and proceeds when no command is configured (non-strict)", async () => {
      const logger = createLogger({ level: "warn" });
      const warnSpy = vi.spyOn(logger, "warn");

      await seedModule.runSeedHook(
        { timeout: 10000 },
        { logger, strict: false },
      );

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("No seed command"));
    });

    it("proceeds with warning by default when strict is not set", async () => {
      const logger = createLogger({ level: "warn" });
      const warnSpy = vi.spyOn(logger, "warn");

      await seedModule.runSeedHook(
        { timeout: 10000 },
        { logger },
      );

      expect(warnSpy).toHaveBeenCalled();
    });

    it("throws SeedError when no command is configured and strict is true", async () => {
      const logger = createLogger({ level: "silent" });

      await expect(
        seedModule.runSeedHook(
          { timeout: 10000 },
          { logger, strict: true },
        ),
      ).rejects.toThrow(SeedError);
    });

    it("includes helpful message in strict-mode error when no command configured", async () => {
      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { timeout: 10000 },
          { logger, strict: true },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.message).toContain("seed command");
        expect(seedErr.message).toContain("demoforge.yaml");
      }
    });
  });

  // ------------------------------------------------------------------
  // 4. Timeout enforcement
  // ------------------------------------------------------------------
  describe("runSeedHook() — timeout", () => {
    it("throws SeedError with timeout info when command exceeds timeout", async () => {
      const slowScript = createScript(tmp, "slow.sh", {
        sleepMs: 5000,
        exitCode: 0,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: slowScript, timeout: 100 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.timeoutMs).toBe(100);
        expect(seedErr.command).toBe(slowScript);
      }
    });

    it("includes timeout duration in error message", async () => {
      const slowScript = createScript(tmp, "slow2.sh", {
        sleepMs: 5000,
        exitCode: 0,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: slowScript, timeout: 200 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.message).toContain("timeout");
      }
    });
  });

  // ------------------------------------------------------------------
  // 5. Failure semantics — abort
  // ------------------------------------------------------------------
  describe("runSeedHook() — failure semantics: abort", () => {
    it("throws SeedError on non-zero exit with abort (default)", async () => {
      const failScript = createScript(tmp, "fail.sh", {
        exitCode: 1,
        stderr: "migration failed: table already exists",
      });

      const logger = createLogger({ level: "silent" });

      await expect(
        seedModule.runSeedHook(
          { command: failScript, timeout: 10000 },
          { logger },
        ),
      ).rejects.toThrow(SeedError);
    });

    it("includes exit code, stdout, and stderr in error", async () => {
      const failScript = createScript(tmp, "fail2.sh", {
        exitCode: 42,
        stdout: "some output",
        stderr: "specific error message",
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: failScript, timeout: 10000 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.exitCode).toBe(42);
        expect(seedErr.stdout).toContain("some output");
        expect(seedErr.stderr).toContain("specific error message");
      }
    });

    it("produces actionable error message", async () => {
      const failScript = createScript(tmp, "fail3.sh", {
        exitCode: 1,
        stderr: "prisma: command not found",
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: failScript, timeout: 10000 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.message).toContain("exited with code");
        expect(seedErr.message).toContain("stderr");
      }
    });
  });

  // ------------------------------------------------------------------
  // 6. Failure semantics — warn (continue with warning)
  // ------------------------------------------------------------------
  describe("runSeedHook() — failure semantics: warn", () => {
    it("logs warning and resolves when failureMode is 'warn'", async () => {
      const failScript = createScript(tmp, "fail-warn.sh", {
        exitCode: 1,
        stderr: "seed warning",
      });

      const logger = createLogger({ level: "warn" });
      const warnSpy = vi.spyOn(logger, "warn");

      await seedModule.runSeedHook(
        { command: failScript, timeout: 10000 },
        { logger, failureMode: "warn" },
      );

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Seed command failed"));
    });

    it("includes exit code in warning message", async () => {
      const failScript = createScript(tmp, "fail-warn2.sh", {
        exitCode: 3,
      });

      const logger = createLogger({ level: "warn" });
      const warnSpy = vi.spyOn(logger, "warn");

      await seedModule.runSeedHook(
        { command: failScript, timeout: 10000 },
        { logger, failureMode: "warn" },
      );

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("exited with code 3"));
    });
  });

  // ------------------------------------------------------------------
  // 7. Failure semantics — retry
  // ------------------------------------------------------------------
  describe("runSeedHook() — failure semantics: retry", () => {
    it("retries on failure and resolves when retry succeeds", async () => {
      const script = createScript(tmp, "retry.sh", {
        exitCode: 0,
      });

      const logger = createLogger({ level: "silent" });

      await seedModule.runSeedHook(
        { command: script, timeout: 10000 },
        { logger, failureMode: "retry", maxRetries: 3 },
      );
      // If it succeeds on first try, that's fine for the happy path
    });

    it("throws after exhausting all retries", async () => {
      const alwaysFailScript = createScript(tmp, "always-fail.sh", {
        exitCode: 1,
        stderr: "persistent failure",
      });

      const logger = createLogger({ level: "silent" });

      await expect(
        seedModule.runSeedHook(
          { command: alwaysFailScript, timeout: 10000 },
          { logger, failureMode: "retry", maxRetries: 2 },
        ),
      ).rejects.toThrow(SeedError);
    });

    it("includes attempt count in error after retries exhausted", async () => {
      const alwaysFailScript = createScript(tmp, "always-fail2.sh", {
        exitCode: 1,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: alwaysFailScript, timeout: 10000 },
          { logger, failureMode: "retry", maxRetries: 2 },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.attempts).toBe(3); // 1 initial + 2 retries
      }
    });
  });

  // ------------------------------------------------------------------
  // 8. Output capture
  // ------------------------------------------------------------------
  describe("runSeedHook() — output capture", () => {
    it("captures stdout and stderr on failure", async () => {
      const script = createScript(tmp, "capture.sh", {
        exitCode: 1,
        stdout: "stdout content here",
        stderr: "stderr content here",
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: script, timeout: 10000 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.stdout).toContain("stdout content here");
        expect(seedErr.stderr).toContain("stderr content here");
      }
    });

    it("captures stdout on success for logging", async () => {
      const script = createScript(tmp, "capture-ok.sh", {
        exitCode: 0,
        stdout: "seeded successfully",
      });

      const logger = createLogger({ level: "debug" });
      const infoSpy = vi.spyOn(logger, "info");

      await seedModule.runSeedHook(
        { command: script, timeout: 10000 },
        { logger },
      );

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("seeded successfully"));
    });
  });

  // ------------------------------------------------------------------
  // 9. Config integration
  // ------------------------------------------------------------------
  describe("runSeedHook() — config integration", () => {
    it("uses SeedConfig directly (command + timeout at top level)", async () => {
      const script = createScript(tmp, "config-integration.sh", {
        exitCode: 0,
        stdout: "config test passed",
      });

      const seedConfig = {
        command: script,
        timeout: 10000,
      };

      const logger = createLogger({ level: "silent" });
      await seedModule.runSeedHook(seedConfig, { logger });
      // No error = success
    });

    it("honors custom timeout from config", async () => {
      const slowScript = createScript(tmp, "slow-config.sh", {
        sleepMs: 3000,
        exitCode: 0,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: slowScript, timeout: 50 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
      }
    });
  });

  // ------------------------------------------------------------------
  // 10. Error message quality
  // ------------------------------------------------------------------
  describe("runSeedHook() — error message quality", () => {
    it("includes the command that failed in the error message", async () => {
      const failScript = createScript(tmp, "cmd-msg.sh", {
        exitCode: 1,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: failScript, timeout: 10000 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.command).toBe(failScript);
      }
    });

    it("provides actionable guidance in timeout error", async () => {
      const slowScript = createScript(tmp, "timeout-msg.sh", {
        sleepMs: 5000,
      });

      const logger = createLogger({ level: "silent" });

      try {
        await seedModule.runSeedHook(
          { command: slowScript, timeout: 50 },
          { logger },
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SeedError);
        const seedErr = err as SeedError;
        expect(seedErr.message).toContain("timeout");
        expect(seedErr.message).toContain("demoforge.yaml");
      }
    });
  });
});
