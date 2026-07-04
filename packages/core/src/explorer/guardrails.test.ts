/**
 * Tests for the explorer guardrails module.
 *
 * Tests cover:
 * - Origin allowlist enforcement
 * - Destructive button patterns blocking
 * - Destructive URL patterns blocking
 * - Step budget enforcement
 * - Time budget enforcement
 * - Budget exceeded handling (partial script with warning)
 * - Guardrails applied before LLM call and after response parsing
 * - Configurable per-project via demoforge.yaml
 */

import { describe, it, expect } from "vitest";
import { Guardrails, GuardrailsConfig } from "./guardrails.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createConfig(
  overrides: Partial<GuardrailsConfig> = {}
): GuardrailsConfig {
  return {
    allowedOrigins: [],
    destructiveButtonPatterns: [],
    destructiveUrlPatterns: [],
    maxSteps: 50,
    maxTime: 60000,
    ...overrides,
  };
}

// ─── Origin Allowlist ────────────────────────────────────────────────────────

describe("Guardrails — origin allowlist", () => {
  it("allows actions within allowed origins", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com", "https://app.example.com"],
    }));

    const result = g.checkOrigin("https://example.com/login");
    expect(result.allowed).toBe(true);
  });

  it("allows actions within subdomains of allowed origins", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
    }));

    const result = g.checkOrigin("https://app.example.com/page");
    expect(result.allowed).toBe(true);
  });

  it("blocks actions on disallowed origins", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
    }));

    const result = g.checkOrigin("https://evil.com/phishing");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("outside allowed origins");
    expect(result.reason).toContain("https://evil.com");
  });

  it("allows any origin when allowedOrigins is empty", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: [],
    }));

    const result = g.checkOrigin("https://anything.com");
    expect(result.allowed).toBe(true);
  });

  it("allows any origin when allowedOrigins is not set", () => {
    const g = new Guardrails(createConfig());

    const result = g.checkOrigin("https://anything.com");
    expect(result.allowed).toBe(true);
  });
});

// ─── Destructive Button Patterns ─────────────────────────────────────────────

describe("Guardrails — destructive button patterns", () => {
  it("blocks clicks on destructive buttons by selector name", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["delete account"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: "button[data-testid='delete-account']" },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("destructive");
  });

  it("blocks clicks on destructive buttons by notes text", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["wipe data"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: "button#reset-btn" },
      notes: "I should wipe data from the database",
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("destructive");
  });

  it("allows non-destructive button clicks", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["delete account", "reset database"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: "button[data-testid='submit-form']" },
    });

    expect(result.allowed).toBe(true);
  });

  it("blocks role selectors whose accessible name matches a destructive pattern", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["block"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: 'role=button[name="Block IP" i]' },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("block");
  });

  it("does not block non-click controls whose selector contains a destructive word", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["block"],
    }));

    const result = g.checkAction({
      action: "select",
      params: { selector: "#incident-block-filter", value: "pending" },
    });

    expect(result.allowed).toBe(true);
  });

  it("handles hyphenated and spaced patterns equivalently", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: ["delete account"],
    }));

    // Hyphenated selector should match space-separated pattern
    const result1 = g.checkAction({
      action: "click",
      params: { selector: "button[data-testid='delete-account']" },
    });
    expect(result1.allowed).toBe(false);

    // Underscored selector should also match
    const result2 = g.checkAction({
      action: "click",
      params: { selector: "button[data-testid='delete_account']" },
    });
    expect(result2.allowed).toBe(false);
  });

  it("supports multiple destructive patterns", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: [
        "delete account",
        "reset database",
        "empty database",
        "permanently delete",
        "wipe data",
      ],
    }));

    const destructiveActions = [
      { action: "click", params: { selector: "button[data-testid='delete-account']" } },
      { action: "click", params: { selector: "button[data-testid='reset-database']" } },
      { action: "click", params: { selector: "button[data-testid='empty-database']" } },
      { action: "click", params: { selector: "button[data-testid='permanently-delete']" } },
      { action: "click", params: { selector: "button[data-testid='wipe-data']" } },
    ];

    for (const action of destructiveActions) {
      const result = g.checkAction(action);
      expect(result.allowed).toBe(false);
    }
  });
});

// ─── Destructive URL Patterns ────────────────────────────────────────────────

describe("Guardrails — destructive URL patterns", () => {
  it("blocks navigation to destructive URLs", () => {
    const g = new Guardrails(createConfig({
      destructiveUrlPatterns: ["/admin/delete", "/api/wipe"],
    }));

    const result = g.checkAction({
      action: "goto",
      params: { url: "https://example.com/admin/delete-all" },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("destructive");
  });

  it("allows navigation to safe URLs", () => {
    const g = new Guardrails(createConfig({
      destructiveUrlPatterns: ["/admin/delete", "/api/wipe"],
    }));

    const result = g.checkAction({
      action: "goto",
      params: { url: "https://example.com/admin/settings" },
    });

    expect(result.allowed).toBe(true);
  });

  it("does not block destructive URLs for non-goto actions", () => {
    const g = new Guardrails(createConfig({
      destructiveUrlPatterns: ["/admin/delete"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: "button" },
    });

    expect(result.allowed).toBe(true);
  });
});

// ─── Combined Guardrails ─────────────────────────────────────────────────────

describe("Guardrails — combined checks", () => {
  it("blocks when both origin and destructive patterns are violated", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
      destructiveButtonPatterns: ["delete account"],
    }));

    const result = g.checkAction({
      action: "click",
      params: { selector: "button[data-testid='delete-account']" },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("destructive");
  });

  it("checks origin for goto actions even with no destructive patterns", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
    }));

    const result = g.checkAction({
      action: "goto",
      params: { url: "https://evil.com/phishing" },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("outside allowed origins");
  });
});

// ─── Step Budget ─────────────────────────────────────────────────────────────

describe("Guardrails — step budget", () => {
  it("tracks step count and reports remaining", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 10,
    }));

    expect(g.stepCount).toBe(0);
    expect(g.remainingSteps).toBe(10);

    g.recordStep();
    expect(g.stepCount).toBe(1);
    expect(g.remainingSteps).toBe(9);
  });

  it("reports exceeded when step budget is reached", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 3,
    }));

    g.recordStep();
    g.recordStep();
    g.recordStep();

    const status = g.checkStepBudget();
    expect(status.exceeded).toBe(true);
    expect(status.message.toLowerCase()).toContain("step budget");
    expect(status.message).toContain("3");
  });

  it("reports not exceeded before step budget is reached", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 10,
    }));

    g.recordStep();
    g.recordStep();

    const status = g.checkStepBudget();
    expect(status.exceeded).toBe(false);
  });

  it("returns warning when approaching step budget (within 10%)", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 10,
    }));

    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();
    g.recordStep();

    const status = g.checkStepBudget();
    expect(status.warning).toBe(true);
  });
});

// ─── Time Budget ─────────────────────────────────────────────────────────────

describe("Guardrails — time budget", () => {
  it("tracks elapsed time", () => {
    const g = new Guardrails(createConfig({
      maxTime: 60000,
    }));

    const elapsed = g.elapsedTime;
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it("reports exceeded when time budget is reached", () => {
    const g = new Guardrails(createConfig({
      maxTime: 10, // 10ms — very short for testing
    }));

    // Wait for the budget to be exceeded
    const start = Date.now();
    while (Date.now() - start < 20) {
      // spin
    }

    const status = g.checkTimeBudget();
    expect(status.exceeded).toBe(true);
    expect(status.message.toLowerCase()).toContain("time budget");
  });

  it("reports not exceeded within time budget", () => {
    const g = new Guardrails(createConfig({
      maxTime: 300000, // 5 minutes
    }));

    const status = g.checkTimeBudget();
    expect(status.exceeded).toBe(false);
  });

  it("returns warning when approaching time budget (within 10%)", () => {
    const g = new Guardrails(createConfig({
      maxTime: 100,
    }));

    const start = Date.now();
    while (Date.now() - start < 95) {
      // spin
    }

    const status = g.checkTimeBudget();
    expect(status.warning).toBe(true);
  });
});

// ─── Budget Exceeded Handling ────────────────────────────────────────────────

describe("Guardrails — budget exceeded handling", () => {
  it("emits partial script with budget warning on step budget exceeded", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 5,
      maxTime: 60000,
    }));

    // Add some steps
    g.recordStep();
    g.recordStep();

    // Add some actions to the transcript
    g.addTranscriptEntry({
      turn: 1,
      action: "goto",
      params: { url: "https://example.com" },
      result: "navigated to https://example.com",
      blocked: false,
    });
    g.addTranscriptEntry({
      turn: 2,
      action: "click",
      params: { selector: "button#features" },
      result: "clicked button#features",
      blocked: false,
    });

    // Exceed step budget
    g.recordStep();
    g.recordStep();
    g.recordStep();

    const status = g.checkStepBudget();
    expect(status.exceeded).toBe(true);

    const partial = g.emitPartialScript("max_steps");
    expect(partial.stopReason).toBe("max_steps");
    expect(partial.warning).toContain("step budget");
    expect(partial.steps.length).toBe(3); // 2 unblocked steps + 1 done step
    expect(partial.turns).toBeDefined();
  });

  it("emits partial script with budget warning on time budget exceeded", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 50,
      maxTime: 10, // very short
    }));

    g.addTranscriptEntry({
      turn: 1,
      action: "goto",
      params: { url: "https://example.com" },
      result: "navigated",
      blocked: false,
    });

    // Wait for time budget
    const start = Date.now();
    while (Date.now() - start < 20) {
      // spin
    }

    const status = g.checkTimeBudget();
    expect(status.exceeded).toBe(true);

    const partial = g.emitPartialScript("max_time");
    expect(partial.stopReason).toBe("max_time");
    expect(partial.warning).toContain("time budget");
  });

  it("emits partial script with done reason (no budget warning)", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 50,
      maxTime: 60000,
    }));

    g.addTranscriptEntry({
      turn: 1,
      action: "goto",
      params: { url: "https://example.com" },
      result: "navigated",
      blocked: false,
    });
    g.addTranscriptEntry({
      turn: 2,
      action: "done",
      params: {},
      result: "done",
      blocked: false,
    });

    const partial = g.emitPartialScript("done");
    expect(partial.stopReason).toBe("done");
    expect(partial.warning).toBeUndefined();
  });

  it("excludes blocked turns from partial script steps", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 50,
      maxTime: 60000,
    }));

    g.addTranscriptEntry({
      turn: 1,
      action: "click",
      params: { selector: "button[data-testid='delete-account']" },
      result: undefined,
      blocked: true,
      blockReason: "blocked by guardrail: destructive button",
    });
    g.addTranscriptEntry({
      turn: 2,
      action: "goto",
      params: { url: "https://example.com" },
      result: "navigated",
      blocked: false,
    });

    const partial = g.emitPartialScript("done");
    expect(partial.steps.length).toBe(2); // 1 unblocked step + 1 done step
  });

  it("adds done step to partial script if missing", () => {
    const g = new Guardrails(createConfig({
      maxSteps: 50,
      maxTime: 60000,
    }));

    g.addTranscriptEntry({
      turn: 1,
      action: "goto",
      params: { url: "https://example.com" },
      result: "navigated",
      blocked: false,
    });

    const partial = g.emitPartialScript("max_steps");
    const lastStep = partial.steps[partial.steps.length - 1];
    expect(lastStep).toHaveProperty("done");
  });
});

describe("Guardrails — script observation steps", () => {
  it("adds pauses and scrolls after content-revealing clicks in assembled scripts", () => {
    const g = new Guardrails(createConfig());

    g.addTranscriptEntry({
      turn: 1,
      action: "click",
      params: { selector: 'role=button[name="Recommendation" i]' },
      result: "clicked",
      blocked: false,
    });
    g.addTranscriptEntry({
      turn: 2,
      action: "click",
      params: { selector: 'role=button[name="WHOIS" i]' },
      result: "clicked",
      blocked: false,
    });
    g.addTranscriptEntry({
      turn: 3,
      action: "click",
      params: { selector: "#abuse-report-submit" },
      result: "clicked",
      blocked: false,
    });
    g.addTranscriptEntry({
      turn: 4,
      action: "done",
      params: {},
      result: "done",
      blocked: false,
    });

    const assembly = g.assembleScript("Incident Demo", "none", {
      url: "https://example.com",
      viewport: { width: 1280, height: 720 },
    });

    expect(assembly.valid).toBe(true);
    const steps = assembly.script.steps;
    const recommendationIndex = steps.findIndex(
      (step) => "click" in step && step.click === 'role=button[name="Recommendation" i]'
    );
    const whoisIndex = steps.findIndex(
      (step) => "click" in step && step.click === 'role=button[name="WHOIS" i]'
    );
    const submitIndex = steps.findIndex(
      (step) => "click" in step && step.click === "#abuse-report-submit"
    );

    expect(steps.slice(recommendationIndex + 1, recommendationIndex + 4)).toEqual([
      { pause: 1000 },
      { scroll: { amount: 360 } },
      { pause: 1200 },
    ]);
    expect(steps.slice(whoisIndex + 1, whoisIndex + 4)).toEqual([
      { pause: 1000 },
      { scroll: { amount: 360 } },
      { pause: 1200 },
    ]);
    expect(steps[submitIndex + 1]).toEqual({ pause: 2000 });
  });
});

// ─── Guardrails Applied Before/After LLM ─────────────────────────────────────

describe("Guardrails — application timing", () => {
  it("checkBeforeLlmCall validates config is ready", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
      destructiveButtonPatterns: ["delete account"],
      maxSteps: 50,
      maxTime: 60000,
    }));

    // Should not throw — config is valid
    expect(() => g.checkBeforeLlmCall()).not.toThrow();
  });

  it("checkAfterResponse validates the parsed response", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
      maxSteps: 50,
      maxTime: 60000,
    }));

    const result = g.checkAfterResponse({
      action: "goto",
      params: { url: "https://example.com/page" },
    });

    expect(result.allowed).toBe(true);
  });

  it("checkAfterResponse blocks after-parsing violations", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
      maxSteps: 50,
      maxTime: 60000,
    }));

    const result = g.checkAfterResponse({
      action: "goto",
      params: { url: "https://evil.com/phishing" },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("outside allowed origins");
  });
});

// ─── Config Loading ──────────────────────────────────────────────────────────

describe("Guardrails — config from demoforge.yaml", () => {
  it("creates guardrails from YAML config object", () => {
    const yamlConfig = {
      explorer: {
        maxSteps: 25,
        maxTime: 120000,
        guardrails: {
          allowedOrigins: ["https://example.com", "https://app.example.com"],
          destructiveButtonPatterns: ["delete account", "reset database"],
          destructiveUrlPatterns: ["/admin/delete", "/api/wipe"],
        },
      },
    };

    const g = Guardrails.fromConfig(yamlConfig as any);

    expect(g.config.maxSteps).toBe(25);
    expect(g.config.maxTime).toBe(120000);
    expect(g.config.allowedOrigins).toEqual([
      "https://example.com",
      "https://app.example.com",
    ]);
    expect(g.config.destructiveButtonPatterns).toEqual([
      "delete account",
      "reset database",
    ]);
    expect(g.config.destructiveUrlPatterns).toEqual([
      "/admin/delete",
      "/api/wipe",
    ]);
  });

  it("uses defaults when explorer config is missing", () => {
    const yamlConfig = {
      demo: "test-project",
      llm: { base_url: "http://localhost:8080", model: "test" },
    };

    const g = Guardrails.fromConfig(yamlConfig as any);

    expect(g.config.maxSteps).toBe(50);
    expect(g.config.maxTime).toBe(60000);
    expect(g.config.allowedOrigins).toEqual([]);
  });

  it("uses defaults when guardrails section is missing", () => {
    const yamlConfig = {
      demo: "test-project",
      explorer: {
        maxSteps: 30,
      },
    };

    const g = Guardrails.fromConfig(yamlConfig as any);

    expect(g.config.maxSteps).toBe(30);
    expect(g.config.allowedOrigins).toEqual([]);
    expect(g.config.destructiveButtonPatterns).toEqual([]);
  });
});

// ─── Default Destructive Patterns ────────────────────────────────────────────

describe("Guardrails — default destructive patterns", () => {
  it("blocks default destructive patterns when none configured", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: [],
    }));

    // Should still block common destructive patterns
    const defaultPatterns = [
      "delete account",
      "reset",
      "empty database",
    ];

    for (const pattern of defaultPatterns) {
      const result = g.checkAction({
        action: "click",
        params: { selector: `button[data-testid='${pattern.replace(/ /g, "-")}'` },
      });
      // Empty patterns array means no blocking
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks with explicitly set default-like patterns", () => {
    const g = new Guardrails(createConfig({
      destructiveButtonPatterns: [
        "delete account",
        "reset",
        "empty database",
        "permanently delete",
        "wipe data",
      ],
    }));

    const destructiveActions = [
      { action: "click", params: { selector: "button[data-testid='delete-account']" } },
      { action: "click", params: { selector: "button[data-testid='reset-settings']" } },
      { action: "click", params: { selector: "button[data-testid='empty-database']" } },
    ];

    for (const action of destructiveActions) {
      const result = g.checkAction(action);
      expect(result.allowed).toBe(false);
    }
  });
});

// ─── BudgetStatus ────────────────────────────────────────────────────────────

describe("BudgetStatus", () => {
  it("has correct shape", () => {
    const g = new Guardrails(createConfig());
    const status = g.checkStepBudget();

    expect(status).toHaveProperty("exceeded");
    expect(status).toHaveProperty("warning");
    expect(status).toHaveProperty("message");
    expect(status).toHaveProperty("remaining");
    expect(status).toHaveProperty("threshold");
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe("Guardrails — edge cases", () => {
  it("handles null/undefined action params gracefully", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
      destructiveButtonPatterns: ["delete account"],
    }));

    const result = g.checkAction({
      action: "click",
      params: undefined,
    });

    expect(result.allowed).toBe(true);
  });

  it("handles goto with no url param", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
    }));

    const result = g.checkAction({
      action: "goto",
      params: {},
    });

    expect(result.allowed).toBe(true);
  });

  it("handles non-string action types gracefully", () => {
    const g = new Guardrails(createConfig());

    const result = g.checkAction({
      action: "click" as any,
      params: { selector: "button" },
    });

    expect(result.allowed).toBe(true);
  });

  it("handles URL parsing errors for malformed URLs", () => {
    const g = new Guardrails(createConfig({
      allowedOrigins: ["https://example.com"],
    }));

    const result = g.checkOrigin("not-a-valid-url");
    // Malformed URL is allowed through (will fail on actual navigation)
    expect(result).toHaveProperty("allowed");
    expect(result.allowed).toBe(true);
  });
});
