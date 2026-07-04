/**
 * DemoForge CLI — init command.
 *
 * Creates a scaffold demoforge.yaml in the current directory.
 */

import { Command } from "commander";
import { initConfig } from "@demoforge/core";
import { createLogger } from "@demoforge/core";

export function createInitCommand(logger: ReturnType<typeof createLogger>): Command {
  return new Command("init")
    .description("Initialize a new DemoForge project with a scaffold config file")
    .option("-o, --output <dir>", "Directory to initialize in (default: current directory)")
    .action(async (options: { output?: string }) => {
      const dir = options.output ?? process.cwd();

      try {
        await initConfig(dir);
        logger.info(`Initialized DemoForge project in ${dir}`);
        logger.info("Edit demoforge.yaml to configure your project.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to initialize project: ${message}`);
        process.exit(1);
      }
    });
}
