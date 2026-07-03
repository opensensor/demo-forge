/**
 * DemoForge CLI — explore command.
 *
 * Uses the LLM-powered explorer agent to discover demo flows from a URL.
 * Usage: demoforge explore <url> [--goal]
 */

import { Command } from "commander";
import { type Config, createLogger } from "@demoforge/core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function createExploreCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("explore")
    .description("Explore a web application and generate a demo script using the LLM agent")
    .argument("<url>", "URL of the web application to explore")
    .option("--goal <goal>", "Description of the demo goal for the explorer")
    .option("-o, --output <dir>", "Output directory for the generated script (default: .demoforge)")
    .action(async (url: string, options: { goal?: string; output?: string }) => {
      logger.debug(`Exploring ${url}`);
      logger.debug(`Goal: ${options.goal || "(not specified)"}`);

      const outputDir = options.output ?? join(process.cwd(), ".demoforge");

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Placeholder: The actual explorer agent implementation will be in @demoforge/core
      // For now, log what would happen
      logger.info(`Exploring ${url}...`);
      logger.info("Explorer agent requires LLM server (llama-server) to be running.");
      logger.info("Start llama-server with: llama-server --model <model> --port 8080");

      const outputPath = join(outputDir, "explore-output.json");
      logger.info(`Output would be written to ${outputPath}`);
      logger.info("Use --goal to guide the exploration toward a specific demo scenario.");
    });
}
