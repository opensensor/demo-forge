/**
 * DemoForge CLI — site command.
 *
 * Generates a static demo site from rendered flows.
 * Usage: demoforge site
 */

import { Command } from "commander";
import { type Config, createLogger } from "@demoforge/core";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { SiteGenerator } from "@demoforge/site";

export function createSiteCommand(
  logger: ReturnType<typeof createLogger>,
  _config: Config,
): Command {
  return new Command("site")
    .description("Generate a static demo site from rendered flows")
    .option("-o, --output <dir>", "Output directory for the static site (default: dist)")
    .option("-s, --source <dir>", "Source directory with rendered assets (default: .demoforge/output)")
    .option("-t, --title <title>", "Site title (default: DemoForge Demos)")
    .option("--theme <mode>", "Theme mode: light or dark (default: light)")
    .option("--no-search", "Disable search functionality")
    .option("--no-tags", "Hide tags on pages")
    .option("--no-metadata", "Hide metadata on flow pages")
    .option("--format <format>", "Default video format: mp4, webm, gif, webp (default: mp4)")
    .option("--validate", "Validate assets before generating site")
    .action(async (options: Record<string, any>) => {
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

      // Discover flows from source directory
      const flows = discoverFlows(sourceDir, logger);

      if (flows.length === 0) {
        logger.warn("No flows found in source directory.");
        logger.info("Expected structure: .demoforge/output/<flow-name>/");
        process.exit(0);
      }

      logger.info(`Found ${flows.length} flow(s) to include in site.`);

      // Asset validation
      if (options.validate) {
        const gen = new SiteGenerator(outputDir, {
          siteTitle: options.title || "DemoForge Demos",
        });
        for (const flow of flows) {
          gen.addFlow(flow);
        }
        const result = gen.validateAssets();

        if (result.errors.length > 0) {
          logger.error(`${result.errors.length} asset error(s):`);
          for (const err of result.errors) {
            logger.error(`  - ${err}`);
          }
        }
        if (result.warnings.length > 0) {
          logger.warn(`${result.warnings.length} asset warning(s):`);
          for (const warn of result.warnings) {
            logger.warn(`  - ${warn}`);
          }
        }
        logger.info(`Validation: ${result.totalFlows} flows, ${result.totalVideos} videos, ${result.totalScreenshots} screenshots`);
        if (!result.valid) {
          logger.warn("Asset validation failed. Site will still be generated.");
        }
      }

      // Build SiteGenerator config
      const siteConfig: Record<string, any> = {
        siteTitle: options.title || "DemoForge Demos",
        searchEnabled: options.search !== false,
        showTags: options.tags !== false,
        showMetadata: options.metadata !== false,
        defaultVideoFormat: options.format || "mp4",
        theme: {
          mode: options.theme || "light",
          colors: {
            primary: "#3b82f6",
            bg: "#ffffff",
            text: "#1e293b",
            cardBg: "#f8fafc",
            cardBorder: "#e2e8f0",
            headerBg: "#f1f5f9",
            footerBg: "#f1f5f9",
            muted: "#64748b",
            accent: "#f59e0b",
          },
          fonts: {
            heading: "Inter, system-ui, sans-serif",
            body: "system-ui, -apple-system, sans-serif",
          },
        },
      };

      // Generate site
      const generator = new SiteGenerator(outputDir, siteConfig);

      for (const flow of flows) {
        generator.addFlow(flow);
      }

      generator.generate();

      logger.info(`Site generated successfully in ${outputDir}`);
      logger.info(`  - ${outputDir}/index.html`);
      logger.info(`  - ${outputDir}/flows/ (${flows.length} flow pages)`);
      logger.info(`  - ${outputDir}/css/site.css`);
      logger.info(`  - ${outputDir}/js/site.js`);
    });
}

function discoverFlows(sourceDir: string, logger: ReturnType<typeof createLogger>): Array<any> {
  const flows: Array<any> = [];

  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const flowDir = join(sourceDir, entry.name);
    const flowName = entry.name;

    // Check if this directory has any render output
    const hasVideo = hasFileByExtension(flowDir, [".mp4", ".webm", ".gif", ".webp"]);
    const hasMetadata = existsSync(join(flowDir, "metadata.json"));

    if (!hasVideo && !hasMetadata) {
      logger.debug(`Skipping ${flowName}: no video or metadata found`);
      continue;
    }

    // Load metadata if available
    let metadata: any = undefined;
    let demoScript: any = undefined;
    let narration: string = "";
    let tags: string[] = [];

    if (hasMetadata) {
      try {
        const metaPath = join(flowDir, "metadata.json");
        const metaContent = JSON.parse(readFileSync(metaPath, "utf-8"));
        metadata = metaContent.metadata || metaContent;
        demoScript = metaContent.demoScript || metaContent.script;
        narration = metaContent.narration || "";
        tags = metaContent.tags || [];
      } catch (e) {
        logger.warn(`Failed to parse metadata for ${flowName}: ${(e as Error).message}`);
      }
    }

    // Discover video files
    const videoFiles: Record<string, string> = {};
    const videoDir = join(flowDir, "videos");
    if (existsSync(videoDir)) {
      for (const file of readdirSync(videoDir)) {
        const ext = getFormat(file);
        if (ext) {
          videoFiles[ext] = join(videoDir, file);
        }
      }
    }

    // Discover screenshot files
    const screenshotFiles: string[] = [];
    const screenshotDir = join(flowDir, "screenshots");
    if (existsSync(screenshotDir)) {
      for (const file of readdirSync(screenshotDir).sort()) {
        if (/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) {
          screenshotFiles.push(join(screenshotDir, file));
        }
      }
    }

    // Discover thumbnail
    const thumbnail = findThumbnail(flowDir);

    // Build flow config
    const flowConfig = {
      name: flowName,
      title: metadata?.title || demoScript?.title || `Demo: ${flowName}`,
      demoScript: demoScript || { demo: flowName, title: flowName, viewport: { width: 1280, height: 720, scale: 1 }, narration_mode: "captions", steps: [] },
      outputDir: flowDir,
      tags,
      thumbnail,
      narration,
      videoFiles,
      screenshotFiles,
      metadata: metadata?.output || metadata,
      steps: demoScript?.steps || [],
    };

    flows.push(flowConfig);
    logger.debug(`Discovered flow: ${flowName}`);
  }

  return flows;
}

function hasFileByExtension(dir: string, extensions: string[]): boolean {
  try {
    const files = readdirSync(dir, { recursive: true });
    for (const file of files) {
      const fullPath = join(dir, file.toString());
      const stat = statSync(fullPath);
      if (stat.isFile()) {
        for (const ext of extensions) {
          if (fullPath.endsWith(ext)) return true;
        }
      }
    }
  } catch {
    // Directory may not exist or be unreadable
  }
  return false;
}

function getFormat(filename: string): string | null {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  const formatMap: Record<string, string> = {
    ".mp4": "mp4",
    ".webm": "webm",
    ".gif": "gif",
    ".webp": "webp",
  };
  return formatMap[ext] || null;
}

function findThumbnail(flowDir: string): string | undefined {
  // Check common thumbnail locations
  const candidates = [
    join(flowDir, "thumbnail.png"),
    join(flowDir, "thumbnail.jpg"),
    join(flowDir, "thumb.png"),
    join(flowDir, "preview.png"),
    join(flowDir, "screenshots", "thumbnail.png"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return relative(flowDir, candidate);
    }
  }

  // Look for any png/jpg in the flow directory
  try {
    for (const file of readdirSync(flowDir)) {
      if (/^thumb|^preview|^screenshot.*\.(png|jpg|jpeg)$/i.test(file)) {
        return file;
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}
