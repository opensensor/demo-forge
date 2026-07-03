/**
 * Seed-data hook execution framework.
 *
 * Executes the user-configured seed command (e.g. `npx prisma db seed`,
 * `python manage.py loaddata fixtures.json`) with timeout enforcement,
 * output capture, and configurable failure semantics.
 *
 * Usage:
 *   await runSeedHook(config, { logger, skipSeed: true });
 *   await runSeedHook(config, { logger, strict: true });
 *   await runSeedHook(config, { logger, failureMode: 'retry', maxRetries: 3 });
 */

import { spawn } from "node:child_process";
import { SeedError } from "../errors/index.js";
import type { SeedConfig } from "../config/config.js";

// Inline logger type matching createLogger's return type
type DFLogger = {
  level: string;
  setLevel(level: string): void;
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  log(entry: { level: string; message: string; timestamp: number; context?: Record<string, unknown> }): void;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration passed to `runSeedHook`. */
export interface SeedHookOptions {
  /** Structured logger for output. */
  logger: DFLogger;
  /** When true, skip seed execution entirely (used by --skip-seed CLI flag). */
  skipSeed?: boolean;
  /** When true, fail if no seed command is configured (used by --strict CLI flag). */
  strict?: boolean;
  /** How to handle a non-zero exit code. Default: "abort". */
  failureMode?: "abort" | "warn" | "retry";
  /** Maximum number of retry attempts (only used when failureMode is "retry"). Default: 3. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Execute the configured seed-data hook.
 *
 * @param config — SeedConfig (from demoforge.yaml `seed` section)
 * @param options — Runtime options controlling execution behavior
 * @throws SeedError when the command fails and failureMode is "abort" (default)
 * @returns void (resolves to undefined on success)
 */
export async function runSeedHook(
  config: SeedConfig,
  options: SeedHookOptions,
): Promise<void> {
  const {
    logger,
    skipSeed = false,
    strict = false,
    failureMode = "abort",
    maxRetries = 3,
  } = options;

  // --skip-seed: skip entirely
  if (skipSeed) {
    logger.info("[seed] Skipping seed hook (--skip-seed flag).");
    return;
  }

  // No command configured
  if (!config.command) {
    if (strict) {
      throw new SeedError(
        "No seed command configured. " +
          "Add a 'seed.command' entry in demoforge.yaml (e.g. 'npx prisma db seed') " +
          "or run without --strict to proceed with a warning.",
        { command: undefined },
      );
    }
    logger.warn(
      "[seed] No seed command configured. Proceeding without seeding. " +
        "Add 'seed.command' in demoforge.yaml to configure a seed hook.",
    );
    return;
  }

  // Execute with retry loop
  const { command, timeout } = config;
  const attempts = [];

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts.push(attempt);

    if (attempt > 1) {
      const backoffMs = 500 * Math.pow(2, attempt - 2);
      logger.debug(`[seed] Retry ${attempt - 1}/${maxRetries} in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }

    try {
      await executeSeedCommand(command, timeout, logger);
      return; // success — exit the retry loop
    } catch (err) {
      if (attempt <= maxRetries && failureMode === "retry") {
        // Will retry on next loop iteration
        continue;
      }

      // Final attempt failed or failureMode is not "retry"
      if (err instanceof SeedError) {
        err.attempts = attempts.length;
      }

      switch (failureMode) {
        case "abort":
          throw err;
        case "warn": {
          const msg = err instanceof SeedError ? err.message : String(err);
          logger.warn(`[seed] Seed command failed: ${msg}`);
          return;
        }
        case "retry":
          // Already handled above; re-throw if this was the last attempt
          throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: execute a single seed command
// ---------------------------------------------------------------------------

/**
 * Execute a single seed command with timeout and output capture.
 * Throws SeedError on failure.
 */
async function executeSeedCommand(
  command: string,
  timeoutMs: number,
  logger: DFLogger,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });

    // Timeout enforcement
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("exit", (exitCode, _signal) => {
      clearTimeout(timer);

      // Collect remaining buffered output
      if (timedOut) {
        const message =
          `Seed command timed out after ${timeoutMs}ms. ` +
          `Increase the timeout in demoforge.yaml or optimize the seed command.`;

        const err = new SeedError(message, {
          command,
          exitCode: null,
          timeoutMs,
          stdout,
          stderr,
          attempts: 1,
        });
        reject(err);
        return;
      }

      if (exitCode === 0) {
        if (stdout) {
          logger.info(`[seed] ${stdout.trim()}`);
        }
        resolve();
        return;
      }

      // Non-zero exit code — failure
      const message =
        `Seed command failed: "${command}" exited with code ${exitCode}. ` +
        `Check stderr for details.`;

      const err = new SeedError(message, {
        command,
        exitCode,
        timeoutMs,
        stdout,
        stderr,
        attempts: 1,
      });
      reject(err);
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      const message = `Seed command failed to start: ${err.message}. ` +
        `Verify the command is available in your PATH.`;
      reject(new SeedError(message, {
        command,
        exitCode: null,
        timeoutMs,
        stdout,
        stderr,
        attempts: 1,
      }));
    });
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Sleep for the specified number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Re-export spawn for testability
// ---------------------------------------------------------------------------

export { spawn };
