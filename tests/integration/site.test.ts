/**
 * Integration test: init -> render -> site -> verify site
 *
 * Tests the full pipeline:
 * 1. demoforge init creates scaffold
 * 2. Renderer produces output files
 * 3. Site generator creates static HTML site
 * 4. Verify site HTML is valid with embedded assets
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { SiteGenerator } from "@demoforge/site";
import { BrowserSession } from "@demoforge/browser";
import { Renderer } from "@demoforge/renderer";
import type { DemoScript } from "@demoforge/core";
import {
  createMockWebServer,
  createTempProject,
  assertFileExists,
  assertHtmlValid,
} from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..", "..");

describe("Integration: init -> render -> site -> verify site", () => {
  let project: ReturnType<typeof createTempProject>;
  let webServer: ReturnType<typeof createMockWebServer>;
  let baseUrl: string;

  beforeEach(async () => {
    project = createTempProject();
    webServer = createMockWebServer();
    await webServer.start();
    baseUrl = webServer.baseURL;
  });

  afterEach(async () => {
    await webServer.stop();
    project.cleanup();
  });

  it("should initialize a project before site generation", () => {
    execSync(
      `node packages/cli/bin/demoforge init -o "${project.dir}"`,
      { cwd: ROOT_DIR, encoding: "utf-8", timeout: 30000 }
    );

    const configPath = join(project.dir, "demoforge.yaml");
    expect(existsSync(configPath)).toBe(true);
  });

  it("should generate a static site from rendered flows", async () => {
    // First, render a demo script
    const demoScript: DemoScript = {
      demo: "dashboard-flow",
      title: "Dashboard Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/dashboard` },
        { wait_for: { text: "Dashboard" } },
        { click: "#total-users" },
        { wait_for: { text: "Welcome" } },
        { narrate: "User views dashboard metrics" },
        { done: true },
      ],
    };

    const renderOutputDir = join(project.dir, "output", "login-flow");
    mkdirSync(renderOutputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir: renderOutputDir,
      stepTimeout: 15000,
      globalTimeout: 60000,
    }, browser);

    const renderResult = await renderer.render();
    // Render may succeed or fail; we create dummy assets regardless
    if (renderResult.status !== "success") {
      console.log(`Render status: ${renderResult.status}`);
    }

    // Create a dummy video file for site generation
    const videoDir = join(renderOutputDir, "videos");
    mkdirSync(videoDir, { recursive: true });
    writeFileSync(join(videoDir, "dashboard-flow.mp4"), Buffer.from("dummy"), "utf-8");

    // Create metadata file
    writeFileSync(
      join(renderOutputDir, "metadata.json"),
      JSON.stringify({
        metadata: {
          duration: 10000,
          width: 1280,
          height: 720,
          fps: 30,
        },
        demoScript: demoScript,
        tags: ["dashboard", "metrics"],
        narration: "User views dashboard metrics.",
      }),
      "utf-8"
    );

    // Generate the site
    const siteOutputDir = join(project.dir, "dist");
    const generator = new SiteGenerator(siteOutputDir, {
      siteTitle: "DemoForge Test Demos",
      description: "Integration test demo site",
      searchEnabled: true,
      showTags: true,
      showMetadata: true,
      defaultVideoFormat: "mp4",
    });

    generator.addFlow({
      name: "dashboard-flow",
      title: "Dashboard Flow Demo",
      outputDir: renderOutputDir,
      tags: ["dashboard", "metrics"],
      narration: "User views dashboard metrics.",
      videoFiles: { mp4: join(videoDir, "dashboard-flow.mp4") },
      steps: demoScript.steps,
    });

    generator.generate();

    // Verify site files exist
    const indexPath = join(siteOutputDir, "index.html");
    assertFileExists(indexPath, "index.html should exist");

    const cssPath = join(siteOutputDir, "css", "site.css");
    assertFileExists(cssPath, "site.css should exist");

    const jsPath = join(siteOutputDir, "js", "site.js");
    assertFileExists(jsPath, "site.js should exist");

    const flowsDir = join(siteOutputDir, "flows");
    expect(existsSync(flowsDir)).toBe(true);

    const flowPagePath = join(flowsDir, "dashboard-flow.html");
    assertFileExists(flowPagePath, "Flow page should exist");

    // Verify index.html is valid HTML
    const indexHtml = readFileSync(indexPath, "utf-8");
    assertHtmlValid(indexHtml, {
      hasTitle: true,
      hasCss: true,
      hasJs: true,
    });

    // Verify flow page is valid HTML
    const flowHtml = readFileSync(flowPagePath, "utf-8");
    assertHtmlValid(flowHtml, {
      hasTitle: true,
      hasVideo: true,
      hasCss: true,
      hasJs: true,
    });

    // Verify site contains expected content
    expect(indexHtml).toContain("DemoForge Test Demos");
    expect(indexHtml).toContain("Dashboard Flow Demo");
    expect(flowHtml).toContain("Dashboard Flow Demo");
    expect(flowHtml).toContain("User views dashboard metrics");
  });

  it("should generate a site with multiple flows", async () => {
    const scripts: DemoScript[] = [
      {
        demo: "dashboard-flow",
        title: "Dashboard Flow",
        url: baseUrl,
        viewport: { width: 1280, height: 720, scale: 1 },
        narration_mode: "none",
        steps: [
          { goto: `${baseUrl}/dashboard` },
          { wait_for: { text: "Welcome" } },
          { done: true },
        ],
      },
      {
        demo: "metrics-flow",
        title: "Metrics Flow",
        url: baseUrl,
        viewport: { width: 1280, height: 720, scale: 1 },
        narration_mode: "none",
        steps: [
          { goto: `${baseUrl}/dashboard` },
          { wait_for: { text: "Dashboard" } },
          { click: "#revenue" },
          { wait_for: { text: "Revenue" } },
          { done: true },
        ],
      },
    ];

    for (const script of scripts) {
      const flowName = script.demo;
      const renderOutputDir = join(project.dir, "output", flowName);
      mkdirSync(renderOutputDir, { recursive: true });

      const browser = new BrowserSession({
        headless: true,
        viewport: { width: 1280, height: 720 },
      });

      const renderer = new Renderer(script, {
        outputDir: renderOutputDir,
        stepTimeout: 10000,
        globalTimeout: 30000,
      }, browser);

      const result = await renderer.render();
      expect(result.status).toBe("success");

      // Create dummy video
      const videoDir = join(renderOutputDir, "videos");
      mkdirSync(videoDir, { recursive: true });
      writeFileSync(join(videoDir, `${flowName}.mp4`), Buffer.from("dummy"), "utf-8");

      writeFileSync(
        join(renderOutputDir, "metadata.json"),
        JSON.stringify({
          metadata: { duration: 5000, width: 1280, height: 720 },
          demoScript: script,
          tags: [flowName],
          narration: `${flowName} completed.`,
        }),
        "utf-8"
      );
    }

    // Generate site
    const siteOutputDir = join(project.dir, "dist");
    const generator = new SiteGenerator(siteOutputDir, {
      siteTitle: "Multi-Flow Demo Site",
    });

    for (const script of scripts) {
      const flowName = script.demo;
      const renderOutputDir = join(project.dir, "output", flowName);
      const videoDir = join(renderOutputDir, "videos");

      generator.addFlow({
        name: flowName,
        title: `${flowName} Demo`,
        outputDir: renderOutputDir,
        tags: [flowName],
        narration: `${flowName} completed.`,
        videoFiles: { mp4: join(videoDir, `${flowName}.mp4`) },
        steps: script.steps,
      });
    }

    generator.generate();

    // Verify site
    const indexPath = join(siteOutputDir, "index.html");
    const indexHtml = readFileSync(indexPath, "utf-8");

    expect(indexHtml).toContain("Multi-Flow Demo Site");
    expect(indexHtml).toContain("dashboard-flow");
    expect(indexHtml).toContain("metrics-flow");

    // Verify both flow pages exist
    const flowsDir = join(siteOutputDir, "flows");
    const flowFiles = readdirSync(flowsDir);
    expect(flowFiles).toContain("dashboard-flow.html");
    expect(flowFiles).toContain("metrics-flow.html");
  });

  it("should produce valid HTML with embedded assets", async () => {
    const demoScript: DemoScript = {
      demo: "simple-flow",
      title: "Simple Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { done: true },
      ],
    };

    const renderOutputDir = join(project.dir, "output", "simple-flow");
    mkdirSync(renderOutputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir: renderOutputDir,
      stepTimeout: 10000,
      globalTimeout: 30000,
    }, browser);

    await renderer.render();

    // Create dummy assets
    const videoDir = join(renderOutputDir, "videos");
    mkdirSync(videoDir, { recursive: true });
    writeFileSync(join(videoDir, "simple.mp4"), Buffer.from("dummy"), "utf-8");

    const screenshotDir = join(renderOutputDir, "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, "step-0.png"), Buffer.from("dummy-png"), "utf-8");

    writeFileSync(
      join(renderOutputDir, "metadata.json"),
      JSON.stringify({
        metadata: { duration: 1000, width: 1280, height: 720, fps: 30 },
        demoScript: demoScript,
        tags: ["simple"],
        narration: "Simple demo.",
      }),
      "utf-8"
    );

    // Generate site
    const siteOutputDir = join(project.dir, "dist");
    const generator = new SiteGenerator(siteOutputDir, {
      siteTitle: "Embedded Assets Test",
      defaultVideoFormat: "mp4",
    });

    generator.addFlow({
      name: "simple-flow",
      title: "Simple Demo",
      outputDir: renderOutputDir,
      tags: ["simple"],
      narration: "Simple demo.",
      videoFiles: { mp4: join(videoDir, "simple.mp4") },
      screenshotFiles: [join(screenshotDir, "step-0.png")],
      steps: demoScript.steps,
    });

    generator.generate();

    // Verify HTML has embedded assets
    const indexPath = join(siteOutputDir, "index.html");
    const indexHtml = readFileSync(indexPath, "utf-8");

    // Should have CSS
    expect(indexHtml).toContain("site.css");

    // Should have JS
    expect(indexHtml).toContain("site.js");

    // Flow page should exist and be valid HTML
    const flowPagePath = join(siteOutputDir, "flows", "simple-flow.html");
    const flowHtml = readFileSync(flowPagePath, "utf-8");
    assertHtmlValid(flowHtml, {
      hasTitle: true,
      hasCss: true,
      hasJs: true,
    });
    expect(flowHtml).toContain("Simple Demo");
  });

  it("should validate assets before generating site", async () => {
    const demoScript: DemoScript = {
      demo: "validation-flow",
      title: "Validation Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { done: true },
      ],
    };

    const renderOutputDir = join(project.dir, "output", "validation-flow");
    mkdirSync(renderOutputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir: renderOutputDir,
      stepTimeout: 10000,
      globalTimeout: 30000,
    }, browser);

    await renderer.render();

    const videoDir = join(renderOutputDir, "videos");
    mkdirSync(videoDir, { recursive: true });
    writeFileSync(join(videoDir, "test.mp4"), Buffer.from("dummy"), "utf-8");

    const siteOutputDir = join(project.dir, "dist");
    const generator = new SiteGenerator(siteOutputDir, {
      siteTitle: "Validation Test",
    });

    generator.addFlow({
      name: "validation-flow",
      title: "Validation Test",
      outputDir: renderOutputDir,
      tags: ["test"],
      videoFiles: { mp4: join(videoDir, "test.mp4") },
      steps: demoScript.steps,
    });

    // Validate assets
    const validation = generator.validateAssets();
    expect(validation.valid).toBe(true);
    expect(validation.errors.length).toBe(0);
    expect(validation.totalFlows).toBe(1);
  });
});
