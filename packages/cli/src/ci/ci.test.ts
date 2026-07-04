/**
 * Tests for DemoForge CI integration module.
 *
 * Validates:
 * - GitHub Action YAML generation (action.yml)
 * - Workflow YAML generation (.github/workflows/demoforge.yml)
 * - Matrix configuration in workflow
 * - Heal step optionality
 * - Browser cache configuration
 * - Asset upload configuration
 * - Init command scaffolds workflow files
 * - Full pipeline validation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// action.yml generation
// ---------------------------------------------------------------------------

describe("CI action.yml generation", () => {
  it("generates valid action.yml with required fields", () => {
    // action.yml must have: name, description, runs, inputs, outputs, etc.
    const actionYaml = readFileSync(join(__dirname, "action.yml"), "utf-8");

    expect(actionYaml).toContain("name: 'DemoForge CI'");
    expect(actionYaml).toContain("uses: actions/checkout@v4");
    expect(actionYaml).toContain("uses: actions/setup-node@v4");
    expect(actionYaml).toContain("uses: actions/cache@v4");
    expect(actionYaml).toContain("uses: actions/upload-artifact@v4");
    expect(actionYaml).toContain("demoforge render");
    expect(actionYaml).toContain("demoforge heal");
    expect(actionYaml).toContain("demoforge site");
    expect(actionYaml).toContain("using: 'composite'");
  });

  it("action.yml includes browser cache step", () => {
    const actionYaml = readFileSync(join(__dirname, "action.yml"), "utf-8");
    expect(actionYaml).toContain("actions/cache@v4");
    expect(actionYaml).toContain("ms-playwright");
    expect(actionYaml).toContain("hashFiles");
  });

  it("action.yml includes ffmpeg check step", () => {
    const actionYaml = readFileSync(join(__dirname, "action.yml"), "utf-8");
    expect(actionYaml).toContain("ffmpeg");
  });
});

// ---------------------------------------------------------------------------
// Workflow YAML generation
// ---------------------------------------------------------------------------

describe("CI workflow YAML generation", () => {
  it("generates valid workflow YAML with triggers", () => {
    const workflowPath = join(__dirname, "..", "..", "..", "..", ".github", "workflows", "demoforge.yml");
    const workflowYaml = readFileSync(workflowPath, "utf-8");

    expect(workflowYaml).toContain("name: DemoForge CI");
    expect(workflowYaml).toContain("on:");
    expect(workflowYaml).toContain("push:");
    expect(workflowYaml).toContain("tags:");
    expect(workflowYaml).toContain("v*");
    expect(workflowYaml).toContain("workflow_dispatch:");
    expect(workflowYaml).toContain("jobs:");
    expect(workflowYaml).toContain("demoforge:");
    expect(workflowYaml).toContain("runs-on: ubuntu-latest");
    expect(workflowYaml).toContain("strategy:");
    expect(workflowYaml).toContain("matrix:");
    expect(workflowYaml).toContain("actions/checkout@v4");
    expect(workflowYaml).toContain("actions/setup-node@v4");
    expect(workflowYaml).toContain("actions/cache@v4");
    expect(workflowYaml).toContain("actions/upload-artifact@v4");
  });

  it("workflow YAML supports matrix configuration", () => {
    const workflowPath = join(__dirname, "..", "..", "..", "..", ".github", "workflows", "demoforge.yml");
    const workflowYaml = readFileSync(workflowPath, "utf-8");
    expect(workflowYaml).toContain("matrix:");
    expect(workflowYaml).toContain("node-version:");
  });

  it("workflow YAML has heal step triggered on failure", () => {
    const workflowPath = join(__dirname, "..", "..", "..", "..", ".github", "workflows", "demoforge.yml");
    const workflowYaml = readFileSync(workflowPath, "utf-8");
    expect(workflowYaml).toContain("if:");
    expect(workflowYaml).toContain("demoforge heal");
  });

  it("workflow YAML has upload-artifact step", () => {
    const workflowPath = join(__dirname, "..", "..", "..", "..", ".github", "workflows", "demoforge.yml");
    const workflowYaml = readFileSync(workflowPath, "utf-8");
    expect(workflowYaml).toContain("upload-artifact@v4");
    expect(workflowYaml).toContain("demoforge-assets");
  });
});

// ---------------------------------------------------------------------------
// Init command scaffolding
// ---------------------------------------------------------------------------

describe("Init command scaffolds workflow files", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(__dirname, "..", "..", "..", `test-ci-scaffold-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("scaffolds .github/workflows/demoforge.yml on init", async () => {
    const { initConfig } = await import("@demoforge/core");
    await initConfig(testDir);

    const workflowPath = join(testDir, ".github", "workflows", "demoforge.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const workflowContent = readFileSync(workflowPath, "utf-8");
    expect(workflowContent).toContain("name: DemoForge CI");
    expect(workflowContent).toContain("on:");
    expect(workflowContent).toContain("push:");
    expect(workflowContent).toContain("workflow_dispatch:");
    expect(workflowContent).toContain("demoforge:");
    expect(workflowContent).toContain("demoforge render");
    expect(workflowContent).toContain("demoforge heal");
    expect(workflowContent).toContain("demoforge site");
    expect(workflowContent).toContain("actions/cache@v4");
    expect(workflowContent).toContain("upload-artifact@v4");
  });

  it("scaffolds action.yml on init", async () => {
    const { initConfig } = await import("@demoforge/core");
    await initConfig(testDir);

    const actionPath = join(testDir, "action.yml");
    expect(existsSync(actionPath)).toBe(true);

    const actionContent = readFileSync(actionPath, "utf-8");
    expect(actionContent).toContain("name: 'DemoForge CI'");
    expect(actionContent).toContain("using: 'composite'");
    expect(actionContent).toContain("demoforge render");
    expect(actionContent).toContain("demoforge heal");
  });

  it("does not overwrite existing workflow files", async () => {
    const { initConfig } = await import("@demoforge/core");

    // Pre-create a workflow file
    const workflowDir = join(testDir, ".github", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "demoforge.yml"),
      "# Custom workflow\nname: Custom\n",
      "utf-8",
    );

    // Init should not overwrite
    await initConfig(testDir);

    const workflowContent = readFileSync(
      join(workflowDir, "demoforge.yml"),
      "utf-8",
    );
    expect(workflowContent).toContain("Custom workflow");
    expect(workflowContent).toContain("Custom");
  });

  it("does not overwrite existing action.yml", async () => {
    const { initConfig } = await import("@demoforge/core");

    // Pre-create an action file
    writeFileSync(
      join(testDir, "action.yml"),
      "# Custom action\nname: Custom\n",
      "utf-8",
    );

    await initConfig(testDir);

    const actionContent = readFileSync(join(testDir, "action.yml"), "utf-8");
    expect(actionContent).toContain("Custom action");
    expect(actionContent).toContain("Custom");
  });
});

// ---------------------------------------------------------------------------
// Workflow YAML validation
// ---------------------------------------------------------------------------

describe("Workflow YAML validation", () => {
  it("workflow YAML is valid YAML", () => {
    const yaml = require("js-yaml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");
    const parsed = yaml.load(content);

    expect(parsed).toBeDefined();
    expect(parsed.name).toBeDefined();
    expect(parsed.on).toBeDefined();
    expect(parsed.jobs).toBeDefined();
  });

  it("action.yml is valid YAML", () => {
    const yaml = require("js-yaml");
    const actionPath = join(__dirname, "action.yml");
    const content = readFileSync(actionPath, "utf-8");
    const parsed = yaml.load(content);

    expect(parsed).toBeDefined();
    expect(parsed.name).toBeDefined();
    expect(parsed.runs).toBeDefined();
    expect(parsed.runs.using).toBe("composite");
  });

  it("workflow YAML has required job steps", () => {
    const yaml = require("js-yaml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");
    const parsed = yaml.load(content);

    const steps = parsed.jobs.demoforge.steps;
    const stepNames = steps.map((s: any) => s.name || s.run || s.uses);

    // Must have checkout
    expect(stepNames.some((n: string) => n && n.includes("Checkout"))).toBe(true);

    // Must have node setup
    expect(stepNames.some((n: string) => n && n.includes("Node"))).toBe(true);

    // Must have install dependencies
    expect(stepNames.some((n: string) => n && n.includes("Install"))).toBe(true);

    // Must have cache
    expect(stepNames.some((n: string) => n && n.includes("Cache"))).toBe(true);

    // Must have render
    expect(stepNames.some((n: string) => n && n.includes("Render"))).toBe(true);

    // Must have site generation
    expect(stepNames.some((n: string) => n && n.includes("site"))).toBe(true);

    // Must have upload
    expect(stepNames.some((n: string) => n && n.includes("Upload"))).toBe(true);
  });

  it("workflow YAML triggers on release tags", () => {
    const yaml = require("js-yaml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");
    const parsed = yaml.load(content);

    expect(parsed.on.push.tags).toBeDefined();
    expect(Array.isArray(parsed.on.push.tags)).toBe(true);
  });

  it("workflow YAML supports workflow_dispatch inputs", () => {
    const yaml = require("js-yaml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");
    const parsed = yaml.load(content);

    expect(parsed.on.workflow_dispatch).toBeDefined();
    expect(parsed.on.workflow_dispatch.inputs).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full pipeline validation
// ---------------------------------------------------------------------------

describe("Full pipeline validation", () => {
  it("action.yml and workflow.yml reference same demoforge commands", () => {
    const actionPath = join(__dirname, "action.yml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );

    const actionContent = readFileSync(actionPath, "utf-8");
    const workflowContent = readFileSync(workflowPath, "utf-8");

    // Both should reference demoforge render
    expect(actionContent).toContain("demoforge render");
    expect(workflowContent).toContain("demoforge render");

    // Both should reference demoforge site
    expect(actionContent).toContain("demoforge site");
    expect(workflowContent).toContain("demoforge site");

    // Heal should be in both (action has it as optional, workflow too)
    expect(actionContent).toContain("demoforge heal");
    expect(workflowContent).toContain("demoforge heal");
  });

  it("browser cache is configured in both action and workflow", () => {
    const actionPath = join(__dirname, "action.yml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );

    const actionContent = readFileSync(actionPath, "utf-8");
    const workflowContent = readFileSync(workflowPath, "utf-8");

    expect(actionContent).toContain("ms-playwright");
    expect(workflowContent).toContain("ms-playwright");
    expect(actionContent).toContain("actions/cache@v4");
    expect(workflowContent).toContain("actions/cache@v4");
  });

  it("asset upload is configured in both action and workflow", () => {
    const actionPath = join(__dirname, "action.yml");
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );

    const actionContent = readFileSync(actionPath, "utf-8");
    const workflowContent = readFileSync(workflowPath, "utf-8");

    expect(actionContent).toContain("upload-artifact@v4");
    expect(workflowContent).toContain("upload-artifact@v4");
    expect(actionContent).toContain("demoforge-assets");
    expect(workflowContent).toContain("demoforge-assets");
  });

  it("matrix configuration is present in workflow", () => {
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");

    expect(content).toContain("strategy:");
    expect(content).toContain("matrix:");
    expect(content).toContain("fail-fast: false");
  });

  it("heal step is conditional on failure", () => {
    const workflowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github",
      "workflows",
      "demoforge.yml",
    );
    const content = readFileSync(workflowPath, "utf-8");

    expect(content).toContain("if:");
    expect(content).toContain("demoforge heal");
  });
});
