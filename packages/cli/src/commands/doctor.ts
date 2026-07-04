/**
 * DemoForge CLI — doctor command.
 *
 * Checks system dependencies: ffmpeg, playwright browsers, llama-server, xvfb.
 * Reports status of each dependency with install instructions for missing ones.
 */

import { Command } from "commander";
import { createLogger } from "@demoforge/core";
import { BrowserSetup } from "@demoforge/browser";
import { spawnSync } from "node:child_process";

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
  // Delegate to @demoforge/browser, which scans the Playwright cache for any
  // installed revision instead of hardcoding revision numbers.
  const installed = BrowserSetup.checkAllInstalled();
  const found = Object.entries(installed)
    .filter(([, ok]) => ok)
    .map(([name]) => name);

  if (found.length > 0) {
    return {
      name: "playwright-browsers",
      status: "ok",
      details: `Installed: ${found.join(", ")}`,
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

      if (warningCount > 0) {
        logger.warn(`  ${warningCount} check(s) reported warnings`);
      }

      if (okCount === results.length) {
        logger.info("  All checks passed! Your system is ready for DemoForge.");
      } else {
        logger.warn("  Some dependencies are missing. Install them before using DemoForge.");
      }
      logger.info("=".repeat(50));
    });
}
