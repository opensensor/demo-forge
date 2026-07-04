/**
 * Integration test: init -> render (break selector) -> heal -> verify repair
 *
 * Tests the heal flow:
 * 1. demoforge init creates scaffold
 * 2. Renderer fails on a broken selector
 * 3. Heal command repairs the broken selector
 * 4. Verify the healed script is valid and the selector is fixed
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  applyPatches,
  extractFailingStep,
  generateSelectorDiff,
  validateDemoScript,
  type DemoScript,
  type SelectorPatch,
} from "@demoforge/core";
import { BrowserSession } from "@demoforge/browser";
import { Renderer } from "@demoforge/renderer";
import {
  createMockWebServer,
  createTempProject,
  assertScriptValid,
} from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..", "..");

describe("Integration: heal flow — break selector and repair", () => {
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

  it("should initialize a project before healing", () => {
    execSync(
      `node packages/cli/bin/demoforge init -o "${project.dir}"`,
      { cwd: ROOT_DIR, encoding: "utf-8", timeout: 30000 }
    );

    const configPath = join(project.dir, "demoforge.yaml");
    expect(existsSync(configPath)).toBe(true);
  });

  it("should detect a broken selector during render", async () => {
    // Script with a broken selector
    const demoScript: DemoScript = {
      demo: "broken-selector-flow",
      title: "Broken Selector Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/dashboard` },
        { wait_for: { text: "Dashboard" } },
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
  });

  it("should extract failing step information from a broken script", () => {
    const demoScript: DemoScript = {
      demo: "broken-flow",
      title: "Broken Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { click: "#broken-button" },
        { done: true },
      ],
    };

    const failingStep = extractFailingStep(demoScript, 1, "Element not found", `${baseUrl}/login`);
    expect(failingStep).not.toBeNull();
    expect(failingStep!.stepIndex).toBe(1);
    expect(failingStep!.actionType).toBe("click");
    expect(failingStep!.oldSelector).toBe("#broken-button");
    expect(failingStep!.url).toBe(`${baseUrl}/login`);
  });

  it("should apply selector patches to repair a broken script", () => {
    const demoScript: DemoScript = {
      demo: "broken-flow",
      title: "Broken Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { click: "#broken-button" },
        { done: true },
      ],
    };

    const patches: SelectorPatch[] = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#broken-button",
        newSelector: "#sign-in-btn",
        explanation: "The old selector targeted a non-existent button. The correct button is 'Sign In'.",
        confidence: 0.95,
      },
    ];

    const healedScript = applyPatches(demoScript, patches);

    // Verify the selector was patched
    const clickStep = healedScript.steps[1];
    expect(clickStep).toHaveProperty("click");
    const clickSelector = clickStep.click as string;
    expect(clickSelector).toBe("#sign-in-btn");
    expect(clickSelector).not.toBe("#broken-button");

    // Verify the original script was not mutated
    const originalClickStep = demoScript.steps[1];
    const originalSelector = originalClickStep.click as string;
    expect(originalSelector).toBe("#broken-button");
  });

  it("should validate the healed script after applying patches", () => {
    const demoScript: DemoScript = {
      demo: "broken-flow",
      title: "Broken Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { fill: { target: { role: "textbox", name: "BrokenField" }, value: "test" } },
        { done: true },
      ],
    };

    const patches: SelectorPatch[] = [
      {
        stepIndex: 1,
        actionType: "fill",
        oldSelector: '[role="textbox"][name="BrokenField"]',
        newSelector: '[role="textbox"][name="email"]',
        explanation: "Fixed the textbox selector to target the email field.",
        confidence: 0.9,
      },
    ];

    const healedScript = applyPatches(demoScript, patches);
    const validation = validateDemoScript(healedScript);
    expect(validation.success).toBe(true);
  });

  it("should generate a readable diff for the selector repair", () => {
    const patches: SelectorPatch[] = [
      {
        stepIndex: 2,
        actionType: "click",
        oldSelector: '[role="button"][name="OldButton"]',
        newSelector: '[role="button"][name="NewButton"]',
        explanation: "Button was renamed from OldButton to NewButton.",
        confidence: 0.9,
      },
      {
        stepIndex: 3,
        actionType: "fill",
        oldSelector: '[role="textbox"][name="old_field"]',
        newSelector: '[role="textbox"][name="new_field"]',
        explanation: "Field was renamed from old_field to new_field.",
        confidence: 0.85,
      },
    ];

    const diff = generateSelectorDiff(patches);
    expect(diff).toContain("OldButton");
    expect(diff).toContain("NewButton");
    expect(diff).toContain("old_field");
    expect(diff).toContain("new_field");
    expect(diff).toContain("click");
    expect(diff).toContain("fill");
  });

  it("should produce a healed script file that validates", async () => {
    const brokenScript: DemoScript = {
      demo: "broken-flow",
      title: "Broken Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { click: { role: "button", name: "BrokenButton" } },
        { fill: { target: { role: "textbox", name: "BrokenField" }, value: "test" } },
        { done: true },
      ],
    };

    const patches: SelectorPatch[] = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: '[role="button"][name="BrokenButton"]',
        newSelector: '[role="button"][name="Sign In"]',
        explanation: "Fixed broken button selector.",
        confidence: 0.95,
      },
      {
        stepIndex: 2,
        actionType: "fill",
        oldSelector: '[role="textbox"][name="BrokenField"]',
        newSelector: '[role="textbox"][name="email"]',
        explanation: "Fixed broken textbox selector.",
        confidence: 0.9,
      },
    ];

    const healedScript = applyPatches(brokenScript, patches);

    // Write healed script to project directory
    const healedPath = join(project.dir, "healed-broken-flow.json");
    writeFileSync(healedPath, JSON.stringify(healedScript, null, 2), "utf-8");

    // Verify the healed script is valid
    const savedScript = JSON.parse(readFileSync(healedPath, "utf-8"));
    assertScriptValid(savedScript, "Healed script should be valid");

    // Verify the patches were applied
    const clickStep = savedScript.steps[1];
    expect(clickStep.click).toContain("Sign In");

    const fillStep = savedScript.steps[2];
    expect((fillStep.fill as Record<string, unknown>).target).toContain("email");
  });

  it("should handle heal with multiple selector types", async () => {
    const demoScript: DemoScript = {
      demo: "multi-selector-flow",
      title: "Multi Selector Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { click: { role: "button", name: "OldLogin" } },
        { fill: { target: { role: "textbox", name: "OldEmail" }, value: "test" } },
        { hover: { role: "link", name: "OldLink" } },
        { select: { target: { role: "combobox", name: "OldSelect" }, value: "opt1" } },
        { done: true },
      ],
    };

    const patches: SelectorPatch[] = [
      { stepIndex: 1, actionType: "click", oldSelector: "OldLogin", newSelector: "Sign In", explanation: "Fixed click", confidence: 0.9 },
      { stepIndex: 2, actionType: "fill", oldSelector: "OldEmail", newSelector: "email", explanation: "Fixed fill", confidence: 0.9 },
      { stepIndex: 3, actionType: "hover", oldSelector: "OldLink", newSelector: "Logout", explanation: "Fixed hover", confidence: 0.85 },
      { stepIndex: 4, actionType: "select", oldSelector: "OldSelect", newSelector: "subject", explanation: "Fixed select", confidence: 0.9 },
    ];

    const healedScript = applyPatches(demoScript, patches);

    // Verify all selectors were patched
    const clickStep = healedScript.steps[1] as Record<string, unknown>;
    expect(clickStep.click).toContain("Sign In");

    const fillStep = healedScript.steps[2] as Record<string, unknown>;
    expect((fillStep.fill as Record<string, unknown>).target).toContain("email");

    const hoverStep = healedScript.steps[3] as Record<string, unknown>;
    expect(hoverStep.hover).toContain("Logout");

    const selectStep = healedScript.steps[4] as Record<string, unknown>;
    expect((selectStep.select as Record<string, unknown>).target).toContain("subject");

    // Validate healed script
    const validation = validateDemoScript(healedScript);
    expect(validation.success).toBe(true);
  });

  it("should not be able to heal non-healable steps", () => {
    const demoScript: DemoScript = {
      demo: "no-selector-flow",
      title: "No Selector Flow",
      url: baseUrl,
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { goto: `${baseUrl}/login` },
        { narrate: "Some narration" },
        { done: true },
      ],
    };

    // Extract failing step for a goto step (no selector)
    const failingStep = extractFailingStep(demoScript, 0, "Navigation failed", `${baseUrl}/login`);
    expect(failingStep).toBeNull();

    // Extract failing step for a narrate step (no selector)
    const narrateFailingStep = extractFailingStep(demoScript, 1, "Narration failed", `${baseUrl}/login`);
    expect(narrateFailingStep).toBeNull();
  });
});
