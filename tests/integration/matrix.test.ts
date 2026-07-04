/**
 * Integration test: init -> render --matrix -> verify all cells
 *
 * Tests the render matrix:
 * 1. demoforge init creates scaffold
 * 2. RenderMatrix renders 3 viewports x 2 themes x 2 locales = 12 cells
 * 3. Verify all expected cells are produced
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { RenderMatrix, computeMatrixCombinations, generateCellId, generateOutputFilename } from "@demoforge/renderer";
import { BrowserSession } from "@demoforge/browser";
import type { DemoScript } from "@demoforge/core";
import { createMockWebServer, createTempProject } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..", "..");

describe("Integration: render --matrix -> verify all cells", () => {
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

  it("should initialize a project before matrix rendering", () => {
    execSync(
      `node packages/cli/bin/demoforge init -o "${project.dir}"`,
      { cwd: ROOT_DIR, encoding: "utf-8", timeout: 30000 }
    );

    const configPath = join(project.dir, "demoforge.yaml");
    expect(existsSync(configPath)).toBe(true);
  });

  it("should compute all matrix combinations correctly (3x2x2=12)", () => {
    const viewports = [
      { width: 1280, height: 720 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ];
    const themes = ["light", "dark"];
    const locales = ["en-US", "es-ES"];

    const cells = computeMatrixCombinations(viewports, themes, locales);

    expect(cells.length).toBe(12);

    // Verify all combinations exist
    const cellIds = cells.map((c) => generateCellId(c.viewport, c.theme, c.locale));

    const expectedIds = [
      "1280x720-light-en-US",
      "1280x720-light-es-ES",
      "1280x720-dark-en-US",
      "1280x720-dark-es-ES",
      "768x1024-light-en-US",
      "768x1024-light-es-ES",
      "768x1024-dark-en-US",
      "768x1024-dark-es-ES",
      "375x667-light-en-US",
      "375x667-light-es-ES",
      "375x667-dark-en-US",
      "375x667-dark-es-ES",
    ];

    for (const expectedId of expectedIds) {
      expect(cellIds).toContain(expectedId);
    }
  });

  it("should generate correct cell IDs", () => {
    expect(generateCellId({ width: 1280, height: 720 }, "light", "en-US")).toBe("1280x720-light-en-US");
    expect(generateCellId({ width: 768, height: 1024 }, "dark", "es-ES")).toBe("768x1024-dark-es-ES");
    expect(generateCellId({ width: 375, height: 667 }, "light", "ja-JP")).toBe("375x667-light-ja-JP");
  });

  it("should generate correct output filenames", () => {
    expect(generateOutputFilename("login-flow", "1280x720-light-en-US", "mp4")).toBe(
      "login-flow-1280x720-light-en-US.mp4"
    );
    expect(generateOutputFilename("dashboard", "768x1024-dark-es-ES", "webm")).toBe(
      "dashboard-768x1024-dark-es-ES.webm"
    );
  });

  it("should render all 12 matrix cells with mock browser", async () => {
    const demoScript: DemoScript = {
      demo: "matrix-test",
      title: "Matrix Test",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { wait_for: { text: "DemoForge" } },
        { done: true },
      ],
    };

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    const viewports = [
      { width: 1280, height: 720 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ];
    const themes = ["light", "dark"] as const;
    const locales = ["en-US", "es-ES"];

    const matrix = new RenderMatrix(demoScript, {
      cells: computeMatrixCombinations(viewports, themes, locales),
      concurrency: 1,
      formats: ["mp4"],
      captureScreenshots: false,
      effects: false,
      createBrowser: (viewport) =>
        new BrowserSession({
          headless: true,
          viewport,
        }),
    });

    expect(matrix.cellCount).toBe(12);

    const result = await matrix.render({
      outputDir,
      flowName: "matrix-test",
      config: { formats: ["mp4"] },
      diffReport: false,
    });

    expect(result.totalCells).toBe(12);
    expect(result.allSuccess).toBe(true);
    expect(result.successfulCells).toBe(12);
    expect(result.failedCells).toBe(0);

    // Verify each cell result
    const cellIds = result.cells.map((c) => c.cellId);
    const expectedIds = [
      "1280x720-light-en-US",
      "1280x720-light-es-ES",
      "1280x720-dark-en-US",
      "1280x720-dark-es-ES",
      "768x1024-light-en-US",
      "768x1024-light-es-ES",
      "768x1024-dark-en-US",
      "768x1024-dark-es-ES",
      "375x667-light-en-US",
      "375x667-light-es-ES",
      "375x667-dark-en-US",
      "375x667-dark-es-ES",
    ];

    for (const expectedId of expectedIds) {
      expect(cellIds).toContain(expectedId);
    }

    // Verify each cell has correct properties
    for (const cell of result.cells) {
      expect(cell).toHaveProperty("cellId");
      expect(cell).toHaveProperty("viewport");
      expect(cell).toHaveProperty("theme");
      expect(cell).toHaveProperty("locale");
      expect(cell).toHaveProperty("success");
      expect(cell).toHaveProperty("outputPaths");
      expect(cell).toHaveProperty("duration");
    }
  });

  it("should handle matrix with explicit cell list", () => {
    const demoScript: DemoScript = {
      demo: "explicit-cells",
      title: "Explicit Cells",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { done: true },
      ],
    };

    const explicitCells = [
      { viewport: { width: 1280, height: 720 }, theme: "light" as const, locale: "en-US" },
      { viewport: { width: 768, height: 1024 }, theme: "dark" as const, locale: "es-ES" },
    ];

    const matrix = new RenderMatrix(demoScript, {
      cells: explicitCells,
      concurrency: 1,
    });

    expect(matrix.cellCount).toBe(2);
    expect(matrix.cells).toEqual(explicitCells);
  });

  it("should handle matrix with single viewport, theme, and locale", () => {
    const demoScript: DemoScript = {
      demo: "single-cell",
      title: "Single Cell",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { done: true },
      ],
    };

    const matrix = new RenderMatrix(demoScript, {
      cells: [
        { viewport: { width: 1280, height: 720 }, theme: "light" as const, locale: "en-US" },
      ],
      concurrency: 1,
    });

    expect(matrix.cellCount).toBe(1);

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    // The result is a promise, but we can check the matrix config
    expect(matrix.cellCount).toBe(1);
  });

  it("should produce output filenames with all matrix dimensions", () => {
    const viewports = [{ width: 1280, height: 720 }];
    const themes = ["light", "dark"] as const;
    const locales = ["en-US", "ja-JP"];

    const cells = computeMatrixCombinations(viewports, themes, locales);

    expect(cells.length).toBe(4);

    // Verify filenames include all dimensions
    for (const cell of cells) {
      const cellId = generateCellId(cell.viewport, cell.theme, cell.locale);
      const filename = generateOutputFilename("test-flow", cellId, "mp4");

      expect(filename).toContain(`${cell.viewport.width}x${cell.viewport.height}`);
      expect(filename).toContain(cell.theme);
      expect(filename).toContain(cell.locale);
      expect(filename).toContain("test-flow");
      expect(filename).toContain(".mp4");
    }
  });

  it("should handle matrix with different viewport sizes", async () => {
    const demoScript: DemoScript = {
      demo: "viewport-test",
      title: "Viewport Test",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: baseUrl },
        { done: true },
      ],
    };

    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 414, height: 896 },
    ];

    const matrix = new RenderMatrix(demoScript, {
      cells: computeMatrixCombinations(viewports, ["light"] as const, ["en-US"]),
      concurrency: 1,
      captureScreenshots: false,
      effects: false,
      createBrowser: (viewport) =>
        new BrowserSession({
          headless: true,
          viewport,
        }),
    });

    expect(matrix.cellCount).toBe(3);

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    const result = await matrix.render({
      outputDir,
      flowName: "viewport-test",
      config: { formats: ["mp4"] },
      diffReport: false,
    });

    expect(result.totalCells).toBe(3);
    expect(result.successfulCells).toBe(3);

    // Verify viewport dimensions in cell results
    const cellViewports = result.cells.map((c) => c.viewport);
    for (const vp of viewports) {
      const found = cellViewports.some(
        (v) => v.width === vp.width && v.height === vp.height
      );
      expect(found).toBe(true);
    }
  });
});
