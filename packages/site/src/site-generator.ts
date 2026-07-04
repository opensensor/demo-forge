/**
 * DemoForge site generator — core SiteGenerator class.
 *
 * Compiles rendered flows into a static demo site with:
 * - Index page: gallery of all flows with thumbnails
 * - Per-flow pages: video player, step timeline, captions, copyable narration
 * - Themeable: light/dark mode toggle, configurable colors/fonts
 * - Search and filter by flow name/tags
 * - Asset validation: checks referenced videos and images exist
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { DemoStep } from "@demoforge/core";
import type { EffectStep, OutputMetadata } from "@demoforge/renderer";
import { generateIndexPage } from "./templates.js";
import { generateFlowPage } from "./templates.js";
import { generateStaticAssets } from "./assets.js";
import { validateAssets } from "./validate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThemeConfig {
  mode: "light" | "dark";
  colors: {
    primary: string;
    bg: string;
    text: string;
    cardBg?: string;
    cardBorder?: string;
    headerBg?: string;
    footerBg?: string;
    muted?: string;
    accent?: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

export interface SiteConfig {
  siteTitle: string;
  description?: string;
  theme: ThemeConfig;
  searchEnabled?: boolean;
  showTags?: boolean;
  showMetadata?: boolean;
  defaultVideoFormat?: "mp4" | "webm" | "gif" | "webp";
}

export interface FlowConfig {
  name: string;
  title: string;
  outputDir: string;
  tags?: string[];
  thumbnail?: string;
  narration?: string;
  effects?: EffectStep[];
  videoFiles?: {
    mp4?: string;
    webm?: string;
    gif?: string;
    webp?: string;
  };
  screenshotFiles?: string[];
  metadata?: OutputMetadata;
  steps?: DemoStep[];
}

export interface FlowInfo {
  name: string;
  title: string;
  tags: string[];
  narration: string;
  thumbnail: string;
  videoFiles: {
    mp4?: string;
    webm?: string;
    gif?: string;
    webp?: string;
  };
  screenshotFiles: string[];
  metadata?: OutputMetadata;
  steps: DemoStep[];
  effects?: EffectStep[];
  stepCount: number;
  duration?: number;
  outputDir: string;
}

export interface AssetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalFlows: number;
  totalVideos: number;
  totalScreenshots: number;
}

// ─── SiteGenerator ────────────────────────────────────────────────────────────

export class SiteGenerator {
  private flows: FlowInfo[] = [];
  private config: Required<SiteConfig>;
  private outputDir: string;

  constructor(outputDir: string, config?: Partial<SiteConfig>) {
    this.outputDir = outputDir;
    this.config = {
      siteTitle: config?.siteTitle ?? "DemoForge Demos",
      description: config?.description ?? "Interactive demo gallery",
      theme: config?.theme ?? {
        mode: "light",
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
      searchEnabled: config?.searchEnabled ?? true,
      showTags: config?.showTags ?? true,
      showMetadata: config?.showMetadata ?? true,
      defaultVideoFormat: config?.defaultVideoFormat ?? "mp4",
    };
  }

  addFlow(flow: FlowConfig): void {
    const existing = this.flows.find((f) => f.name === flow.name);
    if (existing) {
      throw new Error(`Flow already exists: ${flow.name}`);
    }

    const info: FlowInfo = {
      name: flow.name,
      title: flow.title,
      tags: flow.tags ?? [],
      narration: flow.narration ?? "",
      thumbnail: flow.thumbnail ?? "",
      videoFiles: flow.videoFiles ?? {},
      screenshotFiles: flow.screenshotFiles ?? [],
      metadata: flow.metadata,
      steps: flow.steps ?? [],
      effects: flow.effects,
      stepCount: (flow.steps ?? []).length,
      duration: flow.metadata?.duration,
      outputDir: flow.outputDir,
    };

    this.flows.push(info);
  }

  getFlows(): FlowInfo[] {
    return [...this.flows];
  }

  search(query: string): FlowInfo[] {
    if (!query.trim()) return this.getFlows();
    const q = query.toLowerCase();
    return this.flows.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q)) ||
        f.narration.toLowerCase().includes(q),
    );
  }

  filterByTag(tag: string): FlowInfo[] {
    if (!tag.trim()) return this.getFlows();
    const t = tag.toLowerCase();
    return this.flows.filter((f) => f.tags.some((tg) => tg.toLowerCase() === t));
  }

  getAllTags(): string[] {
    const tagSet = new Set<string>();
    for (const flow of this.flows) {
      for (const tag of flow.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }

  validateAssets(): AssetValidationResult {
    return validateAssets(this.flows);
  }

  generate(): void {
    const outputDir = this.outputDir;
    const cssDir = join(outputDir, "css");
    const jsDir = join(outputDir, "js");
    const flowsDir = join(outputDir, "flows");
    const assetsDir = join(outputDir, "assets");

    mkdirSync(cssDir, { recursive: true });
    mkdirSync(jsDir, { recursive: true });
    mkdirSync(flowsDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });

    generateStaticAssets(cssDir, jsDir, this.config);

    const indexHtml = generateIndexPage(this.flows, this.config);
    writeFileSync(join(outputDir, "index.html"), indexHtml, "utf-8");

    for (const flow of this.flows) {
      const flowHtml = generateFlowPage(flow, this.config);
      const flowFile = join(flowsDir, `${flow.name}.html`);
      writeFileSync(flowFile, flowHtml, "utf-8");

      if (flow.thumbnail) {
        const thumbPath = join(flow.outputDir, flow.thumbnail);
        if (existsSync(thumbPath)) {
          const dest = join(assetsDir, `${flow.name}-thumb${extname(flow.thumbnail)}`);
          const data = readFileSync(thumbPath);
          writeFileSync(dest, data);
        }
      }

      for (const [format, src] of Object.entries(flow.videoFiles)) {
        if (src && existsSync(src)) {
          const dest = join(assetsDir, `${flow.name}.${format}`);
          const data = readFileSync(src);
          writeFileSync(dest, data);
        }
      }

      for (const src of flow.screenshotFiles) {
        if (src && existsSync(src)) {
          const name = basename(src);
          const dest = join(assetsDir, `${flow.name}-${name}`);
          const data = readFileSync(src);
          writeFileSync(dest, data);
        }
      }
    }
  }

  getConfig(): Required<SiteConfig> {
    return { ...this.config };
  }
}
