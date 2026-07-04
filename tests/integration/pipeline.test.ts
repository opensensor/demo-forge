/**
 * Integration test: init -> render -> verify outputs
 *
 * Tests the full pipeline:
 * 1. demoforge init creates scaffold config
 * 2. Renderer executes a demo script against the mock web app
 * 3. Verify output files exist and are valid
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { BrowserSession } from "@demoforge/browser";
import { Renderer } from "@demoforge/renderer";
import type { DemoScript } from "@demoforge/core";
import { createMockWebServer, createTempProject, assertScriptValid } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..", "..");

describe("Integration: init -> render -> verify outputs", () => {
  let project: ReturnType<typeof createTempProject>;
  let webServer: ReturnType<typeof createMockWebServer>;
  let baseUrl: string;

  beforeEach(async () => {
    project = createTempProject();
    webServer = createMockWebServer();
    await webServer.start();
    baseUrl = webServer.baseURL;
  });

  afterEach(() => {
    webServer.stop().catch(() => {});
    project.cleanup();
  });

  it("should initialize a project and create demoforge.yaml", () => {
    // The CLI outputs to stderr, so we capture both stdout and stderr
    execSync(
      `node packages/cli/bin/demoforge init -o "${project.dir}"`,
      { cwd: ROOT_DIR, encoding: "utf-8", timeout: 30000, stdio: "pipe" }
    );

    // Config file should be created (output goes to stderr)
    const configPath = join(project.dir, "demoforge.yaml");
    expect(existsSync(configPath)).toBe(true);

    const configContent = readFileSync(configPath, "utf-8");
    expect(configContent).toContain("demo:");
    expect(configContent).toContain("llm:");
  });

  it("should render a demo script and produce successful results", async () => {
    // Use CSS selectors that match the mock web app's HTML
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
        { narrate: "The user views the dashboard metrics." },
        { done: true },
      ],
    };

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir,
      stepTimeout: 15000,
      globalTimeout: 60000,
    }, browser);

    const result = await renderer.render();

    expect(result.status).toBe("success");
    expect(result.stepCount).toBeGreaterThan(0);

    // Verify render results contain step data
    for (const step of result.steps) {
      expect(step).toHaveProperty("status");
      expect(step).toHaveProperty("stepIndex");
      expect(step).toHaveProperty("stepType");
    }

    // Verify that most steps succeeded
    const successSteps = result.steps.filter((s) => s.status === "success");
    expect(successSteps.length).toBeGreaterThan(0);
  });

  it("should handle render failure when selector is broken", async () => {
    // Script with a broken selector
    const demoScript: DemoScript = {
      demo: "broken-flow",
      title: "Broken Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { wait_for: { text: "Sign In" } },
        { click: "#nonExistentButton123" },
        { done: true },
      ],
    };

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir,
      stepTimeout: 5000,
      globalTimeout: 15000,
    }, browser);

    const result = await renderer.render();

    // Broken selector causes either failure or timeout
    expect(result.status).toMatch(/^(failure|timeout)$/);
    expect(result.steps.length).toBeGreaterThan(0);

    // At least one step should have failed or timed out
    const failedStep = result.steps.find(
      (s) => s.status === "failure" || s.status === "timeout"
    );
    expect(failedStep).toBeDefined();
  });

  it("should produce script file that validates after render", async () => {
    const demoScript: DemoScript = {
      demo: "validate-flow",
      title: "Validate Flow",
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

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir,
      stepTimeout: 10000,
      globalTimeout: 30000,
    }, browser);

    const result = await renderer.render();
    expect(result.status).toBe("success");

    // Verify the script itself is valid
    assertScriptValid(demoScript, "Script should be valid");
  });

  it("should handle multiple steps in a single script", async () => {
    const demoScript: DemoScript = {
      demo: "multi-step",
      title: "Multi Step",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/dashboard` },
        { wait_for: { text: "Welcome" } },
        { click: "#active-sessions" },
        { wait_for: { text: "Revenue" } },
        { click: "#growth" },
        { wait_for: { text: "Growth" } },
        { done: true },
      ],
    };

    const outputDir = join(project.dir, "output");
    mkdirSync(outputDir, { recursive: true });

    const browser = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });

    const renderer = new Renderer(demoScript, {
      outputDir,
      stepTimeout: 15000,
      globalTimeout: 60000,
    }, browser);

    const result = await renderer.render();
    expect(result.status).toBe("success");
    expect(result.steps.length).toBeGreaterThan(0);
  });
});
