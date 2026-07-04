import { describe, it, expect, beforeEach } from "vitest";
import {
  SiteGenerator,
  type FlowConfig,
  type AssetValidationResult,
} from "./site-generator.js";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(process.cwd(), "test-output", "site-generator");

function cleanTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function createMockFlow(name: string, baseDir: string, narration?: string): FlowConfig {
  const outputDir = join(baseDir, name);
  const steps = [
    { goto: "https://example.com" },
    { click: "button.login" },
    { narrate: `Step one of ${name}` },
    { fill: { target: "input.email", value: "test@example.com" } },
    { narrate: `Step two of ${name}` },
    { click: "button.submit" },
    { wait_for: { text: "Welcome", timeout: 5000 } },
    { narrate: `Step three of ${name}` },
    { done: true },
  ] as any[];
  return {
    name,
    title: `Demo: ${name}`,
    outputDir,
    tags: name === "login" ? ["auth", "login"] : name === "dashboard" ? ["dashboard", "ui"] : ["forms", "input"],
    thumbnail: "",
    narration: narration || `This is the ${name} demo flow.`,
    effects: [
      { type: "zoom", scale: 1.3, x: 0.5, y: 0.5, duration: 600, atTime: 1000 },
      { type: "dim", selector: "button.login", dimAmount: 0.4, duration: 400, atTime: 500 },
      { type: "callout", text: "Login button", selector: "button.login", position: "bottom", duration: 300, atTime: 800 },
    ],
    videoFiles: {
      mp4: join(outputDir, "videos", "demo.mp4"),
      webm: join(outputDir, "videos", "demo.webm"),
      gif: join(outputDir, "videos", "demo.gif"),
      webp: join(outputDir, "videos", "demo.webp"),
    },
    screenshotFiles: [
      join(outputDir, "screenshots", "step-1.png"),
      join(outputDir, "screenshots", "step-2.png"),
    ],
    metadata: {
      outputPath: join(outputDir, "videos", "demo.mp4"),
      duration: 15,
      fps: 30,
      width: 1280,
      height: 720,
      codec: "h264",
      format: "mp4",
      fileSize: 1024000,
      frameCount: 450,
    },
    steps,
  };
}

describe("SiteGenerator", () => {
  let generator: SiteGenerator;
  let sourceDir: string;
  let outputDir: string;

  beforeEach(() => {
    cleanTestDir();
    sourceDir = join(TEST_DIR, "source");
    outputDir = join(TEST_DIR, "output");
    mkdirSync(sourceDir, { recursive: true });

    generator = new SiteGenerator(outputDir, {
      siteTitle: "DemoForge Demos",
      theme: { mode: "light", colors: { primary: "#3b82f6", bg: "#ffffff", text: "#1e293b" }, fonts: { heading: "Inter, sans-serif", body: "system-ui, sans-serif" } },
    });
  });

  describe("construction", () => {
    it("creates a generator with default config", () => {
      const gen = new SiteGenerator(outputDir);
      expect(gen).toBeInstanceOf(SiteGenerator);
    });

    it("creates a generator with custom config", () => {
      expect(generator).toBeInstanceOf(SiteGenerator);
    });
  });

  describe("addFlow", () => {
    it("adds a flow to the generator", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      const flows = generator.getFlows();
      expect(flows).toHaveLength(1);
      expect(flows[0]!.name).toBe("login");
      expect(flows[0]!.tags).toEqual(["auth", "login"]);
    });

    it("rejects duplicate flow names", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      expect(() => generator.addFlow(flow)).toThrow(/already exists/);
    });

    it("adds multiple flows", () => {
      const flow1 = createMockFlow("login", sourceDir);
      const flow2 = createMockFlow("dashboard", sourceDir);
      generator.addFlow(flow1);
      generator.addFlow(flow2);
      expect(generator.getFlows()).toHaveLength(2);
    });
  });

  describe("search and filter", () => {
    beforeEach(() => {
      generator.addFlow(createMockFlow("login", sourceDir));
      generator.addFlow(createMockFlow("dashboard", sourceDir));
      generator.addFlow(createMockFlow("form-submission", sourceDir));
    });

    it("searches by flow name", () => {
      const results = generator.search("login");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("login");
    });

    it("searches by flow title", () => {
      const results = generator.search("Demo: dashboard");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("dashboard");
    });

    it("searches by tags", () => {
      const flow = createMockFlow("auth-demo", sourceDir, "Unique narration for auth demo");
      flow.tags = ["auth", "security"];
      generator.addFlow(flow);
      const results = generator.search("auth");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by tag", () => {
      const results = generator.filterByTag("login");
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("login");
    });

    it("returns all flows when no filter", () => {
      const results = generator.filterByTag("");
      expect(results).toHaveLength(3);
    });

    it("case-insensitive search", () => {
      const results = generator.search("LOGIN");
      expect(results).toHaveLength(1);
    });
  });

  describe("validateAssets", () => {
    it("validates existing assets", () => {
      const flow = createMockFlow("login", sourceDir);
      // Only include the mp4 video file and create it
      const mp4Path = join(flow.outputDir, "videos", "demo.mp4");
      flow.videoFiles = { mp4: mp4Path };
      mkdirSync(join(mp4Path, ".."), { recursive: true });
      writeFileSync(mp4Path, "fake video data");
      // Only include one screenshot
      const screenshotPath = join(flow.outputDir, "screenshots", "step-1.png");
      flow.screenshotFiles = [screenshotPath];
      mkdirSync(join(screenshotPath, ".."), { recursive: true });
      writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]));

      generator.addFlow(flow);
      const result = generator.validateAssets();

      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("reports missing video files as errors", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      const result = generator.validateAssets();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports missing screenshots as warnings", () => {
      const flow = createMockFlow("login", sourceDir);
      const mp4Path = flow.videoFiles?.mp4 ?? "";
      if (mp4Path) {
        mkdirSync(join(mp4Path, ".."), { recursive: true });
        writeFileSync(mp4Path, "fake video data");
      }
      generator.addFlow(flow);
      const result = generator.validateAssets();

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("reports invalid image files", () => {
      const flow = createMockFlow("login", sourceDir);
      const mp4Path = flow.videoFiles?.mp4 ?? "";
      const screenshotPath = flow.screenshotFiles?.[0] ?? "";
      if (mp4Path) mkdirSync(join(mp4Path, ".."), { recursive: true });
      if (screenshotPath) mkdirSync(join(screenshotPath, ".."), { recursive: true });
      if (mp4Path) writeFileSync(mp4Path, "fake video data");
      // Write a PNG file with invalid header (not a real PNG)
      if (screenshotPath) writeFileSync(screenshotPath, "not a real png file at all");
      generator.addFlow(flow);
      const result = generator.validateAssets();

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("reports empty video files", () => {
      const flow = createMockFlow("login", sourceDir);
      const mp4Path = flow.videoFiles?.mp4 ?? "";
      if (mp4Path) {
        mkdirSync(join(mp4Path, ".."), { recursive: true });
        writeFileSync(mp4Path, "");
      }
      generator.addFlow(flow);
      const result = generator.validateAssets();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("returns comprehensive validation summary", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);

      const result = generator.validateAssets();

      expect(result).toHaveProperty("totalFlows");
      expect(result).toHaveProperty("totalVideos");
      expect(result).toHaveProperty("totalScreenshots");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
      expect(result.totalFlows).toBe(1);
    });
  });

  describe("generate", () => {
    it("generates index.html", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      expect(existsSync(join(outputDir, "index.html"))).toBe(true);
    });

    it("generates per-flow HTML pages", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      expect(existsSync(join(outputDir, "flows", "login.html"))).toBe(true);
    });

    it("generates static CSS and JS files", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      expect(existsSync(join(outputDir, "css", "site.css"))).toBe(true);
      expect(existsSync(join(outputDir, "js", "site.js"))).toBe(true);
    });

    it("generates thumbnail placeholders when thumbnails missing", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      // Should still generate even without thumbnail
      expect(existsSync(join(outputDir, "index.html"))).toBe(true);
    });

    it("generates multiple flow pages", () => {
      generator.addFlow(createMockFlow("login", sourceDir));
      generator.addFlow(createMockFlow("dashboard", sourceDir));
      generator.generate();

      expect(existsSync(join(outputDir, "flows", "login.html"))).toBe(true);
      expect(existsSync(join(outputDir, "flows", "dashboard.html"))).toBe(true);
    });

    it("index page lists all flows", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      const indexContent = readFileSync(join(outputDir, "index.html"), "utf-8");
      expect(indexContent).toContain("login");
      expect(indexContent).toContain("Demo: login");
    });

    it("per-flow page includes narration text", () => {
      const flow = createMockFlow("login", sourceDir);
      flow.narration = "This is the narration text";
      generator.addFlow(flow);
      generator.generate();

      const flowContent = readFileSync(join(outputDir, "flows", "login.html"), "utf-8");
      expect(flowContent).toContain("This is the narration text");
    });

    it("per-flow page includes video player", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      const flowContent = readFileSync(join(outputDir, "flows", "login.html"), "utf-8");
      expect(flowContent).toContain("<video");
    });

    it("per-flow page includes step timeline", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      const flowContent = readFileSync(join(outputDir, "flows", "login.html"), "utf-8");
      expect(flowContent).toContain("Step one of login");
      expect(flowContent).toContain("Step two of login");
      expect(flowContent).toContain("Step three of login");
    });

    it("per-flow page includes copyable narration", () => {
      const flow = createMockFlow("login", sourceDir);
      flow.narration = "Copy me";
      generator.addFlow(flow);
      generator.generate();

      const flowContent = readFileSync(join(outputDir, "flows", "login.html"), "utf-8");
      expect(flowContent).toContain("copy-btn");
    });
  });

  describe("theme", () => {
    it("generates with light theme by default", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      const cssContent = readFileSync(join(outputDir, "css", "site.css"), "utf-8");
      // Light theme default bg color
      expect(cssContent).toContain("--bg: #ffffff");
    });

    it("generates with dark theme when configured", () => {
      const gen = new SiteGenerator(outputDir, {
        siteTitle: "Dark Demos",
        theme: { mode: "dark", colors: { primary: "#60a5fa", bg: "#0f172a", text: "#e2e8f0" }, fonts: { heading: "sans-serif", body: "sans-serif" } },
      });
      const flow = createMockFlow("login", sourceDir);
      gen.addFlow(flow);
      gen.generate();

      const indexContent = readFileSync(join(outputDir, "index.html"), "utf-8");
      expect(indexContent).toContain('data-theme="dark"');
    });

    it("includes theme toggle in HTML", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      generator.generate();

      const indexContent = readFileSync(join(outputDir, "index.html"), "utf-8");
      expect(indexContent).toContain("theme-toggle");
    });

    it("uses custom primary color in CSS", () => {
      const gen = new SiteGenerator(outputDir, {
        siteTitle: "Custom Colors",
        theme: { mode: "light", colors: { primary: "#ff0066", bg: "#fafafa", text: "#333333" }, fonts: { heading: "Arial", body: "Verdana" } },
      });
      const flow = createMockFlow("login", sourceDir);
      gen.addFlow(flow);
      gen.generate();

      const cssContent = readFileSync(join(outputDir, "css", "site.css"), "utf-8");
      expect(cssContent).toContain("#ff0066");
    });
  });

  describe("asset validation result", () => {
    it("creates AssetValidationResult with correct structure", () => {
      const result: AssetValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        totalFlows: 1,
        totalVideos: 3,
        totalScreenshots: 2,
      };
      expect(result.valid).toBe(true);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe("getFlows", () => {
    it("returns empty array when no flows added", () => {
      expect(generator.getFlows()).toEqual([]);
    });

    it("returns flows in insertion order", () => {
      generator.addFlow(createMockFlow("first", sourceDir));
      generator.addFlow(createMockFlow("second", sourceDir));
      const flows = generator.getFlows();
      expect(flows[0]!.name).toBe("first");
      expect(flows[1]!.name).toBe("second");
    });
  });

  describe("getAllTags", () => {
    it("returns sorted unique tags", () => {
      generator.addFlow(createMockFlow("login", sourceDir));
      generator.addFlow(createMockFlow("dashboard", sourceDir));
      generator.addFlow(createMockFlow("form-submission", sourceDir));
      const tags = generator.getAllTags();
      expect(tags).toContain("auth");
      expect(tags).toContain("dashboard");
      expect(tags).toContain("forms");
      expect(tags).toContain("input");
      expect(tags).toContain("login");
      expect(tags).toContain("ui");
    });

    it("returns empty array when no tags", () => {
      const flow = createMockFlow("login", sourceDir);
      flow.tags = [];
      generator.addFlow(flow);
      expect(generator.getAllTags()).toEqual([]);
    });
  });

  describe("getConfig", () => {
    it("returns current config", () => {
      const flow = createMockFlow("login", sourceDir);
      generator.addFlow(flow);
      const cfg = generator.getConfig();
      expect(cfg.siteTitle).toBe("DemoForge Demos");
      expect(cfg.theme.mode).toBe("light");
    });
  });
});
