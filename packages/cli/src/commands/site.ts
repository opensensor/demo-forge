/**
 * DemoForge CLI — site command.
 *
 * Generates a static demo site from rendered flows.
 * Usage: demoforge site
 */

import { Command } from "commander";
import { type Config, createLogger } from "@demoforge/core";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function createSiteCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("site")
    .description("Generate a static demo site from rendered flows")
    .option("-o, --output <dir>", "Output directory for the static site (default: dist)")
    .option("-s, --source <dir>", "Source directory with rendered assets (default: .demoforge/output)")
    .action(async (options: { output?: string; source?: string }) => {
      logger.debug("Generating demo site");

      const sourceDir = options.source ?? join(process.cwd(), ".demoforge", "output");
      const outputDir = options.output ?? join(process.cwd(), "dist");

      if (!existsSync(sourceDir)) {
        logger.error(`Source directory not found: ${sourceDir}`);
        logger.info("Run 'demoforge render' first to generate output assets.");
        process.exit(1);
      }

      mkdirSync(outputDir, { recursive: true });

      logger.info(`Generating static site in ${outputDir}`);
      logger.info(`Source: ${sourceDir}`);
      logger.info("Site generation requires the @demoforge/site package.");
      logger.info("Run 'npm install @demoforge/site' to enable site generation.");
    });
}
