/**
 * `demoforge studio` — launch the Studio web UI for crafting demos.
 */

import { Command } from "commander";
import { createLogger, type Config } from "@demoforge/core";
import { StudioServer } from "@demoforge/studio";

export function createStudioCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("studio")
    .description("Launch the DemoForge Studio web UI for crafting demos from objectives")
    .option("-p, --port <port>", "Port to listen on", "4477")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("-o, --output <dir>", "Artifact output root (default: demoforge-output/studio)")
    .action(async (options: { port: string; host: string; output?: string }) => {
      const server = new StudioServer({
        port: parseInt(options.port, 10),
        host: options.host,
        outputRoot: options.output,
        defaultLlmUrl: config.llm?.base_url,
        defaultModel: config.demo ? config.llm?.model : undefined,
      });

      await server.start();
      logger.info(`DemoForge Studio running at ${server.url}`);
      logger.info("Press Ctrl+C to stop.");

      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
