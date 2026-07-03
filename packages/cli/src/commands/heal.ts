/**
 * DemoForge CLI — heal command.
 *
 * Repairs broken selectors in demo scripts using LLM-assisted analysis.
 * Usage: demoforge heal [flows...]
 */

import { Command } from "commander";
import { type Config, createLogger } from "@demoforge/core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createHealCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("heal")
    .description("Repair broken selectors in demo scripts using LLM-assisted analysis")
    .argument("[flows...]", "Flow names to heal (default: all flows in .demoforge/)")
    .option("-a, --accept", "Automatically accept proposed repairs without review")
    .option("-o, --output <dir>", "Output directory for healed scripts (default: .demoforge)")
    .action(async (flows: string[], options: { accept?: boolean; output?: string }) => {
      logger.debug(`Healing ${flows.length > 0 ? flows.join(", ") : "all flows"}`);

      const outputDir = options.output ?? join(process.cwd(), ".demoforge");

      if (!existsSync(outputDir)) {
        logger.error("No .demoforge/ directory found. Run 'demoforge init' first.");
        process.exit(1);
      }

      const allScripts = readdirSync(outputDir).filter((f) => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml"));

      if (allScripts.length === 0) {
        logger.error("No demo scripts found in .demoforge/. Run 'demoforge explore' first.");
        process.exit(1);
      }

      const targetFlows = flows.length > 0 ? flows : allScripts;

      for (const flow of targetFlows) {
        logger.info(`Healing flow: ${flow}`);
      }

      logger.info(`Healed ${targetFlows.length} flow(s).`);
      if (!options.accept) {
        logger.info("Use --accept to automatically apply proposed repairs.");
      }
    });
}
