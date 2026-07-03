/**
 * DemoForge CLI — doctor command.
 *
 * Checks system dependencies: ffmpeg, playwright browsers, llama-server, xvfb.
 * Reports status of each dependency with install instructions for missing ones.
 */

import { Command } from "commander";
import { createLogger, type Config } from "@demoforge/core";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface CheckResult {
  name: string;
  status: "ok" | "missing" | "warning";
  details: string;
  installHint?: string;
}

function checkExecutable(name: string): CheckResult {
  const result = spawnSync("which", [name], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status === 0 && result.stdout.trim().length > 0) {
    return {
      name,
      status: "ok",
      details: `Found at ${result.stdout.trim()}`,
    };
  }

  const hints: Record<string, string> = {
    ffmpeg: "apt-get install ffmpeg (Debian/Ubuntu) or brew install ffmpeg (macOS)",
    "llama-server": "Download from https://github.com/ggerganov/llama.cpp/releases",
    xvfb: "apt-get install xvfb (Debian/Ubuntu) or brew install --cask xquartz (macOS)",
  };

  return {
    name,
    status: "missing",
    details: "Not found",
    installHint: hints[name] || `Install ${name} for your system`,
  };
}

function checkPlaywrightBrowsers(): CheckResult {
  const cacheHome =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    join(process.env.HOME ?? "/tmp", ".cache", "ms-playwright");

  const chromiumPaths = [
    join(cacheHome, "chromium-1228", "chrome-linux64", "chrome"),
    join(cacheHome, "chromium-1200", "chrome-linux64", "chrome"),
    join(cacheHome, "chromium_headless_shell-1228", "chrome-headless-shell-linux64", "chrome-headless-shell"),
  ];

  const firefoxPaths = [join(cacheHome, "firefox-1532", "firefox", "firefox")];
  const webkitPaths = [join(cacheHome, "webkit-2311", "wkhtmltoimage")];

  const allPaths = [...chromiumPaths, ...firefoxPaths, ...webkitPaths];
  const installed = allPaths.filter((p) => existsSync(p));

  if (installed.length > 0) {
    return {
      name: "playwright-browsers",
      status: "ok",
      details: `Found ${installed.length} browser executable(s)`,
    };
  }

  return {
    name: "playwright-browsers",
    status: "missing",
    details: "No Playwright browsers found",
    installHint: "Run 'npx playwright install' to install browsers",
  };
}

function checkAll(): CheckResult[] {
  return [
    checkExecutable("ffmpeg"),
    checkPlaywrightBrowsers(),
    checkExecutable("llama-server"),
    checkExecutable("xvfb-run"),
  ];
}

export function createDoctorCommand(logger: ReturnType<typeof createLogger>): Command {
  return new Command("doctor")
    .description("Check system dependencies and report status")
    .action(() => {
      const results = checkAll();
      const okCount = results.filter((r) => r.status === "ok").length;
      const missingCount = results.filter((r) => r.status === "missing").length;
      const warningCount = results.filter((r) => r.status === "warning").length;

      logger.info("=".repeat(50));
      logger.info("  DemoForge Doctor — System Dependency Check");
      logger.info("=".repeat(50));

      for (const result of results) {
        const icon = result.status === "ok" ? "✓" : result.status === "warning" ? "!" : "✗";
        logger.info(`  ${icon} ${result.name}: ${result.details}`);
        if (result.installHint) {
          logger.info(`    Install: ${result.installHint}`);
        }
      }

      logger.info("-".repeat(50));
      logger.info(`  Status: ${okCount}/${results.length} checks passed`);

      if (missingCount > 0) {
        logger.warn(`  ${missingCount} dependency(ies) missing`);
      }

      if (okCount === results.length) {
        logger.info("  All checks passed! Your system is ready for DemoForge.");
      } else {
        logger.warn("  Some dependencies are missing. Install them before using DemoForge.");
      }
      logger.info("=".repeat(50));
    });
}
