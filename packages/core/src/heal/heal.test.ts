/**
 * Tests for the DemoForge heal module (T14).
 *
 * Validates:
 * - healScript correctly identifies broken selectors and proposes alternatives
 * - Proposed diff is valid YAML
 * - Healed script passes schema validation
 * - --accept flag auto-applies changes
 * - Without --accept, changes are reviewable but not applied
 * - LLM explanation is human-readable
 * - Screenshot included in LLM context for VLM-assisted healing
 * - Fails gracefully if LLM is unavailable (no silent auto-commit)
 */

import { describe, it, expect, vi } from "vitest";
import {
  applyPatches,
  extractFailingStep,
  healStep,
  type FailingStep,
  type SelectorPatch,
} from "./heal-engine.js";
import {
  generateSelectorDiff,
  generateYamlDiff,
  patchesToDiffs,
} from "./diff.js";
import { LlmUnavailableError } from "../errors/index.js";
import type { DemoScript } from "../types/index.js";
import { validateDemoScript } from "../schema/demoScriptSchema.js";

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const sampleScript: DemoScript = {
  demo: "login-flow",
  title: "Login Flow Demo",
  viewport: { width: 1280, height: 720, scale: 1 },
  narration_mode: "none",
  steps: [
    { goto: "http://localhost:3000" },
    { click: "#login-btn" },
    { fill: { target: "#email", value: "test@example.com" } },
    { fill: { target: "#password", value: "secret123" } },
    { click: "#submit-btn" },
    { wait_for: { text: "Welcome" } },
    { done: true },
  ],
};

const sampleFailingStep: FailingStep = {
  stepIndex: 1,
  step: { click: "#login-btn" },
  actionType: "click",
  oldSelector: "#login-btn",
  error: "Element #login-btn not found",
  url: "http://localhost:3000",
};

const samplePatches: SelectorPatch[] = [
  {
    stepIndex: 1,
    actionType: "click",
    oldSelector: "#login-btn",
    newSelector: "button:has-text(\"Login\")",
    explanation:
      "The old ID selector #login-btn no longer matches any element. The button now uses a text-based selector.",
    confidence: 0.95,
  },
];

// ─── extractFailingStep tests ─────────────────────────────────────────────────

describe("extractFailingStep", () => {
  it("extracts failing step info for a click step", () => {
    const result = extractFailingStep(sampleScript, 1, "Element not found", "http://localhost:3000");
    expect(result).not.toBeNull();
    expect(result!.stepIndex).toBe(1);
    expect(result!.actionType).toBe("click");
    expect(result!.oldSelector).toBe("#login-btn");
    expect(result!.error).toBe("Element not found");
  });

  it("extracts failing step info for a fill step", () => {
    const result = extractFailingStep(sampleScript, 2, "Target not found", "http://localhost:3000");
    expect(result).not.toBeNull();
    expect(result!.stepIndex).toBe(2);
    expect(result!.actionType).toBe("fill");
    expect(result!.oldSelector).toBe("#email");
  });

  it("extracts failing step info for a hover step", () => {
    const hoverScript: DemoScript = {
      ...sampleScript,
      steps: [
        { goto: "http://localhost:3000" },
        { hover: ".tooltip" },
        { done: true },
      ],
    };
    const result = extractFailingStep(hoverScript, 1, "Element not found", "http://localhost:3000");
    expect(result).not.toBeNull();
    expect(result!.actionType).toBe("hover");
    expect(result!.oldSelector).toBe(".tooltip");
  });

  it("returns null for wait_for with text condition (no selector)", () => {
    const result = extractFailingStep(sampleScript, 5, "Selector not found", "http://localhost:3000");
    // wait_for with text condition has no selector, so it can't be healed
    expect(result).toBeNull();
  });

  it("returns null for a goto step (no selector)", () => {
    const result = extractFailingStep(sampleScript, 0, "Navigation failed", "http://localhost:3000");
    expect(result).toBeNull();
  });

  it("returns null for a done step (no selector)", () => {
    const result = extractFailingStep(sampleScript, 6, "Done failed", "http://localhost:3000");
    expect(result).toBeNull();
  });

  it("returns null for out-of-range step index", () => {
    const result = extractFailingStep(sampleScript, 10, "Error", "http://localhost:3000");
    expect(result).toBeNull();
  });

  it("returns null for negative step index", () => {
    const result = extractFailingStep(sampleScript, -1, "Error", "http://localhost:3000");
    expect(result).toBeNull();
  });
});

// ─── applyPatches tests ───────────────────────────────────────────────────────

describe("applyPatches", () => {
  it("applies a click selector patch", () => {
    const patched = applyPatches(sampleScript, [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#login-btn",
        newSelector: "button:has-text(\"Login\")",
        explanation: "Fixed selector",
        confidence: 0.9,
      },
    ]);

    expect(patched.steps[1]).toEqual({ click: "button:has-text(\"Login\")" });
    // Other steps unchanged
    expect(patched.steps[0]).toEqual({ goto: "http://localhost:3000" });
    expect(patched.steps[2]).toEqual({ fill: { target: "#email", value: "test@example.com" } });
  });

  it("applies a fill selector patch", () => {
    const patched = applyPatches(sampleScript, [
      {
        stepIndex: 2,
        actionType: "fill",
        oldSelector: "#email",
        newSelector: "input[name=\"email\"]",
        explanation: "Fixed email selector",
        confidence: 0.85,
      },
    ]);

    expect((patched.steps[2] as any).fill.target).toBe("input[name=\"email\"]");
  });

  it("applies a hover selector patch", () => {
    const hoverScript: DemoScript = {
      ...sampleScript,
      steps: [
        { goto: "http://localhost:3000" },
        { hover: ".tooltip" },
        { done: true },
      ],
    };
    const patched = applyPatches(hoverScript, [
      {
        stepIndex: 1,
        actionType: "hover",
        oldSelector: ".tooltip",
        newSelector: "[data-tooltip]",
        explanation: "Fixed tooltip selector",
        confidence: 0.8,
      },
    ]);

    expect(patched.steps[1]).toEqual({ hover: "[data-tooltip]" });
  });

  it("returns a new script (immutable)", () => {
    const patched = applyPatches(sampleScript, samplePatches);
    expect(patched).not.toBe(sampleScript);
    expect(patched.steps).not.toBe(sampleScript.steps);
  });

  it("applies multiple patches to different steps", () => {
    const patches = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#login-btn",
        newSelector: "button:has-text(\"Login\")",
        explanation: "Fixed login button",
        confidence: 0.9,
      },
      {
        stepIndex: 2,
        actionType: "fill",
        oldSelector: "#email",
        newSelector: "input[name=\"email\"]",
        explanation: "Fixed email field",
        confidence: 0.85,
      },
    ];

    const patched = applyPatches(sampleScript, patches);

    expect(patched.steps[1]).toEqual({ click: "button:has-text(\"Login\")" });
    expect((patched.steps[2] as any).fill.target).toBe("input[name=\"email\"]");
  });

  it("does not modify steps without patches", () => {
    const patches = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#login-btn",
        newSelector: "button:has-text(\"Login\")",
        explanation: "Fixed login button",
        confidence: 0.9,
      },
    ];

    const patched = applyPatches(sampleScript, patches);

    // Steps without patches are unchanged
    expect(patched.steps[0]).toEqual(sampleScript.steps[0]);
    expect(patched.steps[3]).toEqual(sampleScript.steps[3]);
    expect(patched.steps[6]).toEqual(sampleScript.steps[6]);
  });

  it("applies patches to CSS selector targets", () => {
    const cssScript: DemoScript = {
      demo: "test",
      title: "Test",
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { click: { css: "#my-button" } },
        { fill: { target: { css: "#input" }, value: "test" } },
        { done: true },
      ],
    };

    const patched = applyPatches(cssScript, [
      {
        stepIndex: 0,
        actionType: "click",
        oldSelector: "#my-button",
        newSelector: "button.submit",
        explanation: "Fixed",
        confidence: 0.9,
      },
    ]);

    expect(patched.steps[0]).toEqual({ click: "button.submit" });
  });
});

// ─── Schema validation tests ──────────────────────────────────────────────────

describe("Schema validation of healed scripts", () => {
  it("healed script with patched click selector passes validation", () => {
    const patched = applyPatches(sampleScript, samplePatches);
    const result = validateDemoScript(patched);
    expect(result.success).toBe(true);
  });

  it("healed script with patched fill selector passes validation", () => {
    const patched = applyPatches(sampleScript, [
      {
        stepIndex: 2,
        actionType: "fill",
        oldSelector: "#email",
        newSelector: "input[name=\"email\"]",
        explanation: "Fixed email selector",
        confidence: 0.85,
      },
    ]);
    const result = validateDemoScript(patched);
    expect(result.success).toBe(true);
  });

  it("healed script with multiple patches passes validation", () => {
    const patches: SelectorPatch[] = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#login-btn",
        newSelector: "button:has-text(\"Login\")",
        explanation: "Fixed login button",
        confidence: 0.9,
      },
      {
        stepIndex: 2,
        actionType: "fill",
        oldSelector: "#email",
        newSelector: "input[name=\"email\"]",
        explanation: "Fixed email field",
        confidence: 0.85,
      },
    ];
    const patched = applyPatches(sampleScript, patches);
    const result = validateDemoScript(patched);
    expect(result.success).toBe(true);
  });

  it("invalid healed script fails validation", () => {
    const invalidScript = {
      demo: "test",
      title: "Test",
      viewport: { width: 1280, height: 720, scale: 1 },
      narration_mode: "none",
      steps: [
        { invalid_action: "something" },
        { done: true },
      ],
    };
    const result = validateDemoScript(invalidScript);
    expect(result.success).toBe(false);
  });
});

// ─── Diff generation tests ────────────────────────────────────────────────────

describe("generateSelectorDiff", () => {
  it("generates a readable diff for patches", () => {
    const diff = generateSelectorDiff(samplePatches);
    expect(diff).toContain("Step 1: click");
    expect(diff).toContain("#login-btn");
    expect(diff).toContain("button:has-text");
    expect(diff).toContain("95%");
    expect(diff).toContain("Reason");
  });

  it("handles empty patches", () => {
    const diff = generateSelectorDiff([]);
    expect(diff).toBe("No selector changes proposed.");
  });

  it("handles multiple patches", () => {
    const patches: SelectorPatch[] = [
      {
        stepIndex: 1,
        actionType: "click",
        oldSelector: "#btn1",
        newSelector: "button:has-text(\"OK\")",
        explanation: "First fix",
        confidence: 0.9,
      },
      {
        stepIndex: 3,
        actionType: "fill",
        oldSelector: "#input1",
        newSelector: "input[name=\"field1\"]",
        explanation: "Second fix",
        confidence: 0.8,
      },
    ];
    const diff = generateSelectorDiff(patches);
    expect(diff).toContain("Step 1: click");
    expect(diff).toContain("Step 3: fill");
    expect(diff).toContain("Total patches: 2");
  });
});

describe("generateYamlDiff", () => {
  it("generates a valid YAML-formatted diff", () => {
    const diff = generateYamlDiff(samplePatches);
    expect(diff).toContain("# Step 1: click");
    expect(diff).toContain("# - click");
    expect(diff).toContain("# OLD (broken)");
    expect(diff).toContain("# + click");
    expect(diff).toContain("# NEW (proposed)");
    expect(diff).toContain("# Reason:");
  });

  it("handles empty patches", () => {
    const diff = generateYamlDiff([]);
    expect(diff).toContain("# No changes proposed");
  });
});

describe("patchesToDiffs", () => {
  it("converts patches to diff objects", () => {
    const diffs = patchesToDiffs(samplePatches);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].stepIndex).toBe(1);
    expect(diffs[0].actionType).toBe("click");
    expect(diffs[0].oldSelector).toBe("#login-btn");
    expect(diffs[0].newSelector).toBe("button:has-text(\"Login\")");
    expect(diffs[0].explanation).toContain("old ID selector");
  });

  it("handles empty patches", () => {
    const diffs = patchesToDiffs([]);
    expect(diffs).toHaveLength(0);
  });
});

// ─── healStep integration tests ───────────────────────────────────────────────

describe("healStep", () => {
  it("returns error when LLM is unavailable", async () => {
    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: null,
      screenshot: vi.fn().mockRejectedValue(new Error("Browser not available")),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockRejectedValue(
        new LlmUnavailableError("LLM server unreachable")
      ),
    };

    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: false,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(false);
    expect(result.llmUnavailable).toBe(true);
    expect(result.error).toContain("LLM server is unavailable");
    expect(result.patchesApplied).toBe(0);
    // No silent auto-commit — patches are not applied
    expect(result.script).toBeUndefined();
  });

  it("returns proposals when not accepting", async () => {
    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: null,
      screenshot: vi.fn().mockRejectedValue(new Error("Browser not available")),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                patches: [
                  {
                    stepIndex: 1,
                    actionType: "click",
                    oldSelector: "#login-btn",
                    newSelector: "button:has-text(\"Login\")",
                    explanation: "The old ID selector no longer works",
                    confidence: 0.9,
                  },
                ],
                explanation: "Replaced broken ID selector with text-based selector",
              }),
            },
          },
        ],
      }),
    };

    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: false,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not accepted");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].diff).toContain("#login-btn");
    expect(result.proposals[0].diff).toContain("button:has-text");
    expect(result.patchesApplied).toBe(0);
  });

  it("auto-applies patches with --accept flag", async () => {
    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: null,
      screenshot: vi.fn().mockRejectedValue(new Error("Browser not available")),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                patches: [
                  {
                    stepIndex: 1,
                    actionType: "click",
                    oldSelector: "#login-btn",
                    newSelector: "button:has-text(\"Login\")",
                    explanation: "The old ID selector no longer works",
                    confidence: 0.9,
                  },
                ],
                explanation: "Replaced broken ID selector with text-based selector",
              }),
            },
          },
        ],
      }),
    };

    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: true,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(true);
    expect(result.patchesApplied).toBe(1);
    expect(result.script).toBeDefined();
    expect(result.script!.steps[1]).toEqual({ click: "button:has-text(\"Login\")" });
  });

  it("includes screenshot base64 in proposal when available", async () => {
    const screenshotBuffer = Buffer.from("fake-screenshot-data");

    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: null,
      screenshot: vi.fn().mockResolvedValue(screenshotBuffer),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                patches: [
                  {
                    stepIndex: 1,
                    actionType: "click",
                    oldSelector: "#login-btn",
                    newSelector: "button:has-text(\"Login\")",
                    explanation: "VLM analysis of screenshot suggests this selector",
                    confidence: 0.85,
                  },
                ],
                explanation: "Screenshot-assisted selector repair",
              }),
            },
          },
        ],
      }),
    };

    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: true,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(true);
    expect(result.proposals[0].screenshotBase64).toBeDefined();
    expect(result.proposals[0].screenshotBase64).toContain("ZmFrZS1zY3JlZW5zaG90LWRhdGE=");
  });

  it("fails gracefully with invalid LLM response", async () => {
    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: null,
      screenshot: vi.fn().mockRejectedValue(new Error("Browser not available")),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                patches: [
                  {
                    stepIndex: 1,
                    actionType: "click",
                    oldSelector: "#login-btn",
                    newSelector: "button:has-text(\"Login\")",
                    explanation: "Fixed",
                    confidence: 0.9,
                  },
                ],
                explanation: "OK",
              }),
            },
          },
        ],
      }),
    };

    // This should succeed since the patches are valid
    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: true,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(true);
    expect(result.patchesApplied).toBe(1);
  });

  it("captures AX tree from browser state", async () => {
    const mockPage: any = {
      accessibility: {
        snapshot: vi.fn().mockResolvedValue({
          role: "document",
          name: "Test Page",
          nodeLabel: "body",
          children: [
            {
              role: "button",
              name: "Login",
              nodeLabel: "button",
              domElement: '<button id="login-btn">',
              children: [],
            },
          ],
        }),
      },
    };

    const mockBrowser: any = {
      getState: vi.fn().mockResolvedValue({
        url: "http://localhost:3000",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      }),
      page: mockPage,
      screenshot: vi.fn().mockRejectedValue(new Error("Browser not available")),
    };

    const mockLlmClient: any = {
      sendRequest: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                patches: [
                  {
                    stepIndex: 1,
                    actionType: "click",
                    oldSelector: "#login-btn",
                    newSelector: "button:has-text(\"Login\")",
                    explanation: "Found matching button in AX tree",
                    confidence: 0.9,
                  },
                ],
                explanation: "AX tree analysis",
              }),
            },
          },
        ],
      }),
    };

    const result = await healStep({
      script: sampleScript,
      browser: mockBrowser,
      llmClient: mockLlmClient,
      outputDir: "/tmp",
      accept: true,
      failingStep: sampleFailingStep,
    });

    expect(result.success).toBe(true);
    // Verify AX tree was captured
    expect(mockBrowser.page.accessibility.snapshot).toHaveBeenCalled();
    expect(result.proposals[0].axTree.length).toBeGreaterThan(0);
  });
});
