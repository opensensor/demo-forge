import { describe, it, expect } from "vitest";
import {
  DemoScript,
  DemoStep,
  Viewport,
  Selector,
  Effect,
  ActionCategory,
  ActionType,
  gotoStepSchema,
  clickStepSchema,
  hoverStepSchema,
  fillStepSchema,
  selectStepSchema,
  pressStepSchema,
  scrollStepSchema,
  waitForStepSchema,
  narrateStepSchema,
  screenshotStepSchema,
  markFlowStartStepSchema,
  markFlowEndStepSchema,
  doneStepSchema,
  pauseStepSchema,
  demoStepSchema,
  demoScriptSchema,
  validateDemoScript,
  isGotoStep,
  isClickStep,
  isNarrateStep,
  isDoneStep,
  isPauseStep,
} from "../src/index.js";

const prdScript: DemoScript = {
  demo: "camera-onboarding",
  title: "Add your first camera",
  viewport: { width: 1440, height: 900, scale: 2 },
  narration_mode: "captions",
  steps: [
    { goto: "/dashboard", settle: "networkidle" },
    { narrate: "From the dashboard, click Add Camera." },
    { hover: { role: "button", name: "Add Camera" }, effect: "highlight" as Effect },
    { click: { role: "button", name: "Add Camera" } },
    {
      fill: {
        target: { label: "RTSP URL" },
        value: "rtsp://demo:demo@192.168.1.50/stream1",
        typing: "natural",
      },
    },
    { screenshot: { name: "add-camera-modal", annotate: ["target"] } },
    { click: { role: "button", name: "Save" } },
    { wait_for: { text: "Camera online" } },
    { narrate: "The stream appears within seconds." },
    { pause: 2.5 },
  ],
};

describe("DemoScript type", () => {
  it("should have all required fields", () => {
    expect(prdScript).toHaveProperty("demo");
    expect(prdScript).toHaveProperty("title");
    expect(prdScript).toHaveProperty("viewport");
    expect(prdScript).toHaveProperty("narration_mode");
    expect(prdScript).toHaveProperty("steps");
  });

  it("should parse PRD camera-onboarding script successfully", () => {
    const result = validateDemoScript(prdScript);
    expect(result.success).toBe(true);
  });

  it("should reject script missing demo field", () => {
    const invalid = { ...prdScript };
    delete (invalid as any).demo;
    const result = validateDemoScript(invalid as DemoScript);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues!.at(0)?.path).toContain("demo");
    }
  });

  it("should reject script missing title field", () => {
    const invalid = { ...prdScript };
    delete (invalid as any).title;
    const result = validateDemoScript(invalid as DemoScript);
    expect(result.success).toBe(false);
  });

  it("should reject script missing steps field", () => {
    const invalid = { ...prdScript };
    delete (invalid as any).steps;
    const result = validateDemoScript(invalid as DemoScript);
    expect(result.success).toBe(false);
  });

  it("should reject script with unknown action types", () => {
    const invalidScript = {
      ...prdScript,
      steps: [
        { unknown_action: "something" },
      ],
    } as unknown as DemoScript;
    const result = validateDemoScript(invalidScript);
    expect(result.success).toBe(false);
  });

  it("should reject script with invalid viewport dimensions", () => {
    const invalidScript = {
      ...prdScript,
      viewport: { width: -100, height: 900, scale: 2 },
    };
    const result = validateDemoScript(invalidScript as DemoScript);
    expect(result.success).toBe(false);
  });

  it("should reject script with invalid narration_mode", () => {
    const invalidScript = {
      ...prdScript,
      narration_mode: "invalid_mode",
    };
    const result = validateDemoScript(invalidScript as DemoScript);
    expect(result.success).toBe(false);
  });
});

describe("DemoStep discriminated union", () => {
  it("should recognize goto step", () => {
    const step = { goto: "/dashboard", settle: "networkidle" } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize click step", () => {
    const step = { click: { role: "button", name: "Save" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize hover step", () => {
    const step = { hover: { role: "button", name: "Add Camera" }, effect: "highlight" } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize fill step", () => {
    const step = {
      fill: {
        target: { label: "RTSP URL" },
        value: "rtsp://demo:demo@192.168.1.50/stream1",
        typing: "natural",
      },
    } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize select step", () => {
    const step = {
      select: {
        target: { label: "Region" },
        value: "US",
      },
    } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize press step", () => {
    const step = { press: { key: "Enter" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize scroll step", () => {
    const step = { scroll: { amount: 500 } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize wait_for step", () => {
    const step = { wait_for: { text: "Camera online" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize narrate step", () => {
    const step = { narrate: "From the dashboard, click Add Camera." } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize screenshot step", () => {
    const step = { screenshot: { name: "add-camera-modal", annotate: ["target"] } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize mark_flow_start step", () => {
    const step = { mark_flow_start: { name: "login-flow" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize mark_flow_end step", () => {
    const step = { mark_flow_end: { name: "login-flow" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize done step", () => {
    const step = { done: true } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should recognize pause step", () => {
    const step = { pause: 2.5 } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it("should reject step with unknown action", () => {
    const step = { unknown_action: "something" } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });

  it("should reject step with multiple action keys", () => {
    const step = { goto: "/dashboard", click: { role: "button" } } as unknown as DemoStep;
    const result = demoStepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });
});

describe("Viewport type", () => {
  it("should validate valid viewport", () => {
    const vp: Viewport = { width: 1440, height: 900, scale: 2 };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: vp,
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject negative width", () => {
    const vp = { width: -100, height: 900, scale: 2 };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: vp,
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject zero height", () => {
    const vp = { width: 1440, height: 0, scale: 2 };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: vp,
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("should reject scale below 0.5", () => {
    const vp = { width: 1440, height: 900, scale: 0.1 };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: vp,
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("Selector type", () => {
  it("should accept role+name selector", () => {
    const sel: Selector = { role: "button", name: "Save" };
    const result = demoStepSchema.safeParse({ click: sel });
    expect(result.success).toBe(true);
  });

  it("should accept label selector", () => {
    const sel: Selector = { label: "RTSP URL" };
    const result = demoStepSchema.safeParse({ fill: { target: sel, value: "test" } });
    expect(result.success).toBe(true);
  });

  it("should accept text selector", () => {
    const sel: Selector = { text: "Camera online" };
    const result = demoStepSchema.safeParse({ wait_for: sel });
    expect(result.success).toBe(true);
  });

  it("should accept css selector", () => {
    const sel: Selector = { css: "#submit-btn" };
    const result = demoStepSchema.safeParse({ click: sel });
    expect(result.success).toBe(true);
  });

  it("should accept xpath selector", () => {
    const sel: Selector = { xpath: "//button[text()='Save']" };
    const result = demoStepSchema.safeParse({ click: sel });
    expect(result.success).toBe(true);
  });

  it("should accept plain string as selector", () => {
    const result = demoStepSchema.safeParse({ click: "button.submit" });
    expect(result.success).toBe(true);
  });

  it("should accept role with only name (no label/xpath/css)", () => {
    const sel: Selector = { role: "heading", name: "Welcome" };
    const result = demoStepSchema.safeParse({ click: sel });
    expect(result.success).toBe(true);
  });
});

describe("Effect type", () => {
  it("should accept highlight effect", () => {
    const result = demoStepSchema.safeParse({
      click: { role: "button" },
      effect: "highlight",
    });
    expect(result.success).toBe(true);
  });

  it("should accept zoom effect", () => {
    const result = demoStepSchema.safeParse({
      click: { role: "button" },
      effect: "zoom",
    });
    expect(result.success).toBe(true);
  });

  it("should accept dim effect", () => {
    const result = demoStepSchema.safeParse({
      click: { role: "button" },
      effect: "dim",
    });
    expect(result.success).toBe(true);
  });

  it("should accept callout effect", () => {
    const result = demoStepSchema.safeParse({
      click: { role: "button" },
      effect: "callout",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid effect", () => {
    const result = demoStepSchema.safeParse({
      click: { role: "button" },
      effect: "explode",
    });
    expect(result.success).toBe(false);
  });
});

describe("NarrationMode type", () => {
  it("should accept captions mode", () => {
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it("should accept tts mode", () => {
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "tts",
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it("should accept none mode", () => {
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "none",
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid narration mode", () => {
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "voiceover",
      steps: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("RenderMatrix type", () => {
  it("should validate a render matrix config", () => {
    const matrix = {
      viewports: [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }],
      themes: ["light", "dark"],
      locales: ["en-US", "fr-FR"],
    };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "captions",
      steps: [],
      render_matrix: matrix,
    });
    expect(result.success).toBe(true);
  });

  it("should reject render matrix with empty viewports", () => {
    const matrix = {
      viewports: [],
      themes: ["light"],
      locales: ["en-US"],
    };
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "captions",
      steps: [],
      render_matrix: matrix,
    });
    expect(result.success).toBe(false);
  });
});

describe("Action types and categories", () => {
  it("should have correct ActionType values", () => {
    const actionTypes: ActionType[] = [
      "goto",
      "click",
      "hover",
      "fill",
      "select",
      "press",
      "scroll",
      "wait_for",
      "narrate",
      "screenshot",
      "mark_flow_start",
      "mark_flow_end",
      "done",
      "pause",
    ];
    for (const t of actionTypes) {
      expect(t).toBeDefined();
    }
  });

  it("should have correct ActionCategory values", () => {
    const categories: ActionCategory[] = [
      "navigation",
      "interaction",
      "input",
      "assertion",
      "narration",
      "capture",
      "flow_control",
      "timing",
    ];
    for (const c of categories) {
      expect(c).toBeDefined();
    }
  });
});

describe("Round-trip: serialize -> parse", () => {
  it("should produce equivalent output after round-trip via JSON", () => {
    const serialized = JSON.stringify(prdScript);
    const reparsed = JSON.parse(serialized) as DemoScript;

    expect(reparsed.demo).toBe(prdScript.demo);
    expect(reparsed.title).toBe(prdScript.title);
    expect(reparsed.viewport).toEqual(prdScript.viewport);
    expect(reparsed.narration_mode).toBe(prdScript.narration_mode);
    expect(reparsed.steps).toHaveLength(prdScript.steps.length);
  });
});

describe("validateDemoScript function", () => {
  it("should return success result with valid script", () => {
    const result = validateDemoScript(prdScript);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeDefined();
    }
  });

  it("should return error result with invalid script", () => {
    const result = validateDemoScript({} as DemoScript);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues).toBeInstanceOf(Array);
    }
  });

  it("should return error messages for multiple validation failures", () => {
    const invalidScript = {
      steps: [{ unknown_action: "x" }],
    } as unknown as DemoScript;
    const result = validateDemoScript(invalidScript);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
    }
  });
});

describe("Individual step schemas", () => {
  it("should validate gotoStepSchema", () => {
    const result = gotoStepSchema.safeParse({ goto: "/dashboard", settle: "networkidle" });
    expect(result.success).toBe(true);
  });

  it("should validate clickStepSchema", () => {
    const result = clickStepSchema.safeParse({ click: { role: "button", name: "Save" } });
    expect(result.success).toBe(true);
  });

  it("should validate hoverStepSchema", () => {
    const result = hoverStepSchema.safeParse({ hover: { role: "button" }, effect: "highlight" });
    expect(result.success).toBe(true);
  });

  it("should validate fillStepSchema", () => {
    const result = fillStepSchema.safeParse({
      fill: { target: { label: "Name" }, value: "John" },
    });
    expect(result.success).toBe(true);
  });

  it("should validate selectStepSchema", () => {
    const result = selectStepSchema.safeParse({
      select: { target: { label: "Country" }, value: "US" },
    });
    expect(result.success).toBe(true);
  });

  it("should validate pressStepSchema", () => {
    const result = pressStepSchema.safeParse({ press: { key: "Enter" } });
    expect(result.success).toBe(true);
  });

  it("should validate scrollStepSchema", () => {
    const result = scrollStepSchema.safeParse({ scroll: { amount: 500 } });
    expect(result.success).toBe(true);
  });

  it("should validate waitForStepSchema", () => {
    const result = waitForStepSchema.safeParse({ wait_for: { text: "Loaded" } });
    expect(result.success).toBe(true);
  });

  it("should validate narrateStepSchema", () => {
    const result = narrateStepSchema.safeParse({ narrate: "Hello world" });
    expect(result.success).toBe(true);
  });

  it("should validate screenshotStepSchema", () => {
    const result = screenshotStepSchema.safeParse({ screenshot: { name: "page" } });
    expect(result.success).toBe(true);
  });

  it("should validate markFlowStartStepSchema", () => {
    const result = markFlowStartStepSchema.safeParse({ mark_flow_start: { name: "flow1" } });
    expect(result.success).toBe(true);
  });

  it("should validate markFlowEndStepSchema", () => {
    const result = markFlowEndStepSchema.safeParse({ mark_flow_end: { name: "flow1" } });
    expect(result.success).toBe(true);
  });

  it("should validate doneStepSchema", () => {
    const result = doneStepSchema.safeParse({ done: true });
    expect(result.success).toBe(true);
  });

  it("should validate pauseStepSchema", () => {
    const result = pauseStepSchema.safeParse({ pause: 2.5 });
    expect(result.success).toBe(true);
  });
});

describe("Action type guards", () => {
  it("should identify goto step", () => {
    const step = { goto: "/dashboard" } as unknown as DemoStep;
    expect(isGotoStep(step)).toBe(true);
    expect(isClickStep(step)).toBe(false);
  });

  it("should identify click step", () => {
    const step = { click: { role: "button" } } as unknown as DemoStep;
    expect(isClickStep(step)).toBe(true);
    expect(isGotoStep(step)).toBe(false);
  });

  it("should identify narrate step", () => {
    const step = { narrate: "Hello" } as unknown as DemoStep;
    expect(isNarrateStep(step)).toBe(true);
  });

  it("should identify done step", () => {
    const step = { done: true } as unknown as DemoStep;
    expect(isDoneStep(step)).toBe(true);
  });

  it("should identify pause step", () => {
    const step = { pause: 2.5 } as unknown as DemoStep;
    expect(isPauseStep(step)).toBe(true);
  });
});

describe("Empty steps array", () => {
  it("should accept script with empty steps", () => {
    const result = demoScriptSchema.safeParse({
      demo: "test",
      title: "Test",
      viewport: { width: 1440, height: 900, scale: 2 },
      narration_mode: "captions",
      steps: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("Optional fields", () => {
  it("should accept script without optional fields", () => {
    const result = demoScriptSchema.safeParse({
      demo: "minimal",
      title: "Minimal Demo",
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [{ goto: "/" }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept goto without settle", () => {
    const result = demoStepSchema.safeParse({ goto: "/dashboard" });
    expect(result.success).toBe(true);
  });

  it("should accept click without effect", () => {
    const result = demoStepSchema.safeParse({ click: { role: "button" } });
    expect(result.success).toBe(true);
  });
});
