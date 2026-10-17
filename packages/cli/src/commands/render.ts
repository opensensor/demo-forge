/**
 * DemoForge CLI — render command.
 *
 * Renders demo scripts into video, GIF, captions, and screenshots.
 * Usage: demoforge render [targets...]
 *
 * A target is a flow name in .demoforge/ (with or without extension) or a
 * path to a .json/.yaml script. With no targets, every script in .demoforge/
 * is rendered.
 */

import { Command } from "commander";
import { type Config, type NarrationMode, createLogger, loadDemoScript } from "@demoforge/core";
import { renderDemo, type DeliverableFormat, type TtsBackendName } from "@demoforge/renderer";
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const SCRIPT_EXTENSIONS = [".json", ".yaml", ".yml"];

interface RenderOptions {
  output?: string;
  formats: string;
  narration?: string;
  tts?: string;
  voice?: string;
  burnCaptions?: boolean;
  video: boolean;
  width?: string;
}

/** Resolve CLI targets to script file paths. */
export function resolveTargets(targets: string[], demoDir: string): string[] {
  // Files starting with "_" are shared bases for `extends`, not demos.
  const isScript = (f: string) => SCRIPT_EXTENSIONS.includes(extname(f).toLowerCase()) && !f.startsWith("_");

  const listDir = (dir: string) =>
    readdirSync(dir)
      .filter(isScript)
      .sort()
      .map((f) => join(dir, f));

  if (targets.length === 0) {
    if (!existsSync(demoDir)) {
      throw new Error("No .demoforge/ directory found. Run 'demoforge init' first or pass a script path.");
    }
    return listDir(demoDir);
  }

  return targets.flatMap((target) => {
    if (existsSync(target)) {
      return statSync(target).isDirectory() ? listDir(target) : [resolve(target)];
    }
    for (const ext of ["", ...SCRIPT_EXTENSIONS]) {
      const candidate = join(demoDir, `${target}${ext}`);
      if (existsSync(candidate) && statSync(candidate).isFile()) return [candidate];
    }
    throw new Error(`Demo script not found: ${target}`);
  });
}

export function createRenderCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("render")
    .description("Render demo scripts into video and other output assets")
    .argument("[targets...]", "Flow names in .demoforge/ or script paths (default: all flows in .demoforge/)")
    .option("-o, --output <dir>", "Output root; each demo renders into <dir>/<demo>", ".demoforge/output")
    .option("-f, --formats <list>", "Comma-separated video formats: mp4,gif,webm", "mp4,gif")
    .option("--narration <mode>", "Override narration mode: none | captions | tts")
    .option("--tts <backend>", "TTS backend for narration_mode tts: kokoro | piper | openai", "kokoro")
    .option("--voice <voice>", "TTS voice (overrides the script's voice)")
    .option("--burn-captions", "Burn captions into the video (default for captions mode)")
    .option("--no-video", "Skip recording; only run steps and capture screenshots")
    .option("--width <px>", "Output video width (default: viewport width)")
    .action(async (targets: string[], options: RenderOptions) => {
      let files: string[];
      try {
        files = resolveTargets(targets, join(process.cwd(), ".demoforge"));
      } catch (err) {
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (files.length === 0) {
        logger.error("No demo scripts found. Run 'demoforge explore' or pass a script path.");
        process.exit(1);
      }

      const formats = options.formats
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean) as DeliverableFormat[];
      const narrationMode = (options.narration ?? undefined) as NarrationMode | undefined;
      let failures = 0;

      for (const file of files) {
        let script;
        try {
          script = loadDemoScript(file);
        } catch (err) {
          logger.error(err instanceof Error ? err.message : String(err));
          failures++;
          continue;
        }

        const outputDir = resolve(options.output ?? ".demoforge/output", script.demo);
        logger.info(`Rendering ${script.demo} (${script.steps.length} steps) → ${outputDir}`);

        const result = await renderDemo(script, {
          outputDir,
          narrationMode: narrationMode ?? script.narration_mode ?? config.narration?.mode,
          ttsBackend: options.tts as TtsBackendName,
          voice: options.voice,
          video: options.video,
          formats,
          burnCaptions: options.burnCaptions,
          videoWidth: options.width ? parseInt(options.width, 10) : undefined,
          onLog: (message) => logger.debug(`[${script.demo}] ${message}`),
        });

        if (result.render.status !== "success") {
          failures++;
          const bad = result.render.steps.find((s) => s.status === "failure" || s.status === "timeout");
          const detail = bad && "error" in bad ? bad.error : bad ? `timed out` : "unknown error";
          logger.error(`${script.demo}: ${result.render.status} at step ${bad?.stepIndex} (${bad?.stepType}): ${detail}`);
          continue;
        }

        for (const [format, path] of Object.entries(result.produced?.outputs ?? {})) {
          logger.info(`  ${format}: ${path}`);
        }
        for (const shot of result.render.screenshots ?? []) {
          logger.info(`  screenshot: ${shot}`);
        }
        for (const error of result.produced?.errors ?? []) {
          logger.warn(`  ${error}`);
        }
      }

      logger.info(`Rendered ${files.length - failures}/${files.length} demo(s).`);
      if (failures > 0) process.exit(1);
    });
}
