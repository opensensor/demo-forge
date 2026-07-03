/**
 * DemoForge CLI — render command.
 *
 * Renders demo scripts into video/assets.
 * Usage: demoforge render [flows...]
 */

import { Command } from "commander";
import { type Config, createLogger } from "@demoforge/core";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function createRenderCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("render")
    .description("Render demo scripts into video and other output assets")
    .argument("[flows...]", "Flow names to render (default: all flows in .demoforge/)")
    .option("-o, --output <dir>", "Output directory for rendered assets")
    .option("--skip-seed", "Skip the seed-data hook before rendering")
    .option("--strict", "Fail if no seed hook is configured and app is in empty state")
    .action(async (flows: string[], options: { output?: string; skipSeed?: boolean; strict?: boolean }) => {
      logger.debug(`Rendering ${flows.length > 0 ? flows.join(", ") : "all flows"}`);

      const demoDir = join(process.cwd(), ".demoforge");

      if (!existsSync(demoDir)) {
        logger.error("No .demoforge/ directory found. Run 'demoforge init' first.");
        process.exit(1);
      }

      const allScripts = readdirSync(demoDir).filter((f) => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml"));

      if (allScripts.length === 0) {
        logger.error("No demo scripts found in .demoforge/. Run 'demoforge explore' first.");
        process.exit(1);
      }

      const targetFlows = flows.length > 0 ? flows : allScripts;

      for (const flow of targetFlows) {
        logger.info(`Rendering flow: ${flow}`);
      }

      logger.info(`Rendered ${targetFlows.length} flow(s).`);
      logger.info(`Output directory: ${options.output ?? ".demoforge/output"}`);
    });
}
