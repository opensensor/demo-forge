/**
 * Tests for the explorer transcript — transcript logging, script assembly,
 * human confirmation UI, and file persistence.
 *
 * Tests cover:
 * - Transcript class with turn-by-turn logging
 * - Each turn: page state snapshot, LLM request (truncated), LLM response, action executed, action result
 * - Script assembly: collects all steps into valid Demo Script structure
 * - Human confirmation UI: presents proposed flows, waits for user input (accept/reject/modify)
 * - Transcript saved to .demoforge/transcript/ for debugging
 * - Transcript format: JSON with timestamps for each turn
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, unlink, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validateDemoScript } from "../schema/demoScriptSchema.js";
import { DemoForgeError } from "../errors/index.js";
import type { DemoScript, DemoStep } from "../types/index.js";
import type {
  PageState,
  LlmActionResponse,
  ExplorerConfig,
  ProgressReporter,
  ProgressEvent,
} from "./types.js";
import {
  Transcript,
  ScriptAssembly,
  HumanConfirmUI,
  truncateContent,
  createTranscriptDir,
  saveTranscriptToFile,
  loadTranscriptFromFile,
  buildDemoScriptFromTranscript,
} from "./transcript.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TRANSIENT_DIR = join(process.cwd(), ".demoforge", "transcript", "test-transient");

function ensureTransientDir(): void {
  mkdirSync(TRANSIENT_DIR, { recursive: true });
}

function cleanupTransientDir(): void {
  if (existsSync(TRANSIENT_DIR)) {
    const files = require("node:fs").readdirSync(TRANSIENT_DIR);
    for (const file of files) {
      try {
        unlinkSync(join(TRANSIENT_DIR, file));
      } catch {
        // ignore
      }
    }
    try {
      require("node:fs").rmdirSync(TRANSIENT_DIR);
    } catch {
      // ignore
    }
  }
}

function unlinkSync(path: string): void {
  try {
    require("node:fs").unlinkSync(path);
  } catch {
    // ignore
  }
}

function createMockPageState(
  url = "https://example.com",
  title = "Example"
): PageState {
  return {
    url,
    title,
    viewport: { width: 1280, height: 720 },
    axTree: [
      {
        role: "heading",
        name: "Welcome",
        tag: "h1",
        depth: 1,
        interactive: false,
      },
      {
        role: "button",
        name: "Sign In",
        tag: "button",
        depth: 2,
        interactive: true,
        selector: "button[data-testid='sign-in']",
      },
    ],
    selectors: ["button[data-testid='sign-in']"],
    formFields: [],
  };
}

function createMockReporter(): ProgressReporter {
  const events: ProgressEvent[] = [];
  return {
    report(event: ProgressEvent): void {
      events.push(event);
    },
    get events() {
      return events;
    },
  };
}

function createLlmResponse(
  action: string,
  params: Record<string, unknown> = {},
  narration?: string,
  notes?: string
): LlmActionResponse {
  return { action, params, narration, notes };
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe("Transcript", () => {
  let transcript: Transcript;

  beforeEach(() => {
    transcript = new Transcript({
      url: "https://example.com",
      goal: "Test goal",
    });
  });

  describe("turn-by-turn logging", () => {
    it("starts with zero turns", () => {
      expect(transcript.getTurns()).toEqual([]);
      expect(transcript.getTotalTurns()).toBe(0);
      expect(transcript.getBlockedTurns()).toBe(0);
    });

    it("records a turn with all required fields", () => {
      const pageState = createMockPageState();
      const systemPrompt = "You are an explorer agent.";
      const llmRequest = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: "What should I do?" },
      ];
      const llmResponse = createLlmResponse("click", { selector: "button" });
      const actionResult = "clicked button";

      transcript.addTurn({
        turn: 1,
        startTime: new Date("2024-01-01T00:00:00Z").toISOString(),
        pageState,
        systemPrompt,
        llmRequest,
        llmResponse,
        selectedAction: llmResponse,
        executedAction: llmResponse,
        blocked: false,
        actionResult,
      });

      const turns = transcript.getTurns();
      expect(turns.length).toBe(1);

      const turn = turns[0];
      expect(turn.turn).toBe(1);
      expect(turn.pageState).toEqual(pageState);
      expect(turn.systemPrompt).toBe(systemPrompt);
      expect(turn.llmRequest).toEqual(llmRequest);
      expect(turn.llmResponse).toEqual(llmResponse);
      expect(turn.selectedAction).toEqual(llmResponse);
      expect(turn.executedAction).toEqual(llmResponse);
      expect(turn.blocked).toBe(false);
      expect(turn.actionResult).toBe(actionResult);
      expect(turn.endTime).toBeDefined();
    });

    it("records blocked turns with reason", () => {
      const pageState = createMockPageState();
      const llmResponse = createLlmResponse("click", { selector: "delete-account" });

      transcript.addTurn({
        turn: 1,
        startTime: new Date("2024-01-01T00:00:00Z").toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse,
        selectedAction: llmResponse,
        blocked: true,
        blockReason: "blocked by guardrail: destructive button",
      });

      const turns = transcript.getTurns();
      expect(turns.length).toBe(1);
      expect(turns[0].blocked).toBe(true);
      expect(turns[0].blockReason).toBe("blocked by guardrail: destructive button");
      expect(turns[0].executedAction).toBeUndefined();
      expect(turns[0].actionResult).toBeUndefined();
    });

    it("records turn errors separately from blocked turns", () => {
      const pageState = createMockPageState();
      const llmResponse = createLlmResponse("goto", { url: "https://example.com" });

      transcript.addTurn({
        turn: 1,
        startTime: new Date("2024-01-01T00:00:00Z").toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse,
        selectedAction: llmResponse,
        executedAction: llmResponse,
        blocked: false,
        actionResult: "error: navigation failed",
        error: "net::ERR_CONNECTION_REFUSED",
      });

      const turns = transcript.getTurns();
      expect(turns[0].blocked).toBe(false);
      expect(turns[0].error).toBe("net::ERR_CONNECTION_REFUSED");
      expect(turns[0].actionResult).toBe("error: navigation failed");
    });

    it("increments turn counters correctly", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z").toISOString();

      // Add 3 normal turns
      for (let i = 1; i <= 3; i++) {
        transcript.addTurn({
          turn: i,
          startTime: baseTime,
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: `btn${i}` }),
          selectedAction: createLlmResponse("click", { selector: `btn${i}` }),
          executedAction: createLlmResponse("click", { selector: `btn${i}` }),
          blocked: false,
          actionResult: `clicked btn${i}`,
        });
      }

      // Add 2 blocked turns
      for (let i = 4; i <= 5; i++) {
        transcript.addTurn({
          turn: i,
          startTime: baseTime,
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: "delete" }),
          selectedAction: createLlmResponse("click", { selector: "delete" }),
          blocked: true,
          blockReason: "destructive action",
        });
      }

      expect(transcript.getTotalTurns()).toBe(5);
      expect(transcript.getBlockedTurns()).toBe(2);
      expect(transcript.getTurns().length).toBe(5);
    });

    it("records timestamps in order", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      for (let i = 0; i < 5; i++) {
        const time = new Date(baseTime.getTime() + i * 1000);
        transcript.addTurn({
          turn: i + 1,
          startTime: time.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: `btn${i}` }),
          selectedAction: createLlmResponse("click", { selector: `btn${i}` }),
          executedAction: createLlmResponse("click", { selector: `btn${i}` }),
          blocked: false,
          actionResult: `clicked btn${i}`,
        });
      }

      const turns = transcript.getTurns();
      for (let i = 1; i < turns.length; i++) {
        const prev = new Date(turns[i - 1].startTime).getTime();
        const curr = new Date(turns[i].startTime).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("supports adding turns without explicit turn number (auto-increment)", () => {
      const pageState = createMockPageState();

      transcript.addTurn({
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("click", { selector: "btn1" }),
        selectedAction: createLlmResponse("click", { selector: "btn1" }),
        executedAction: createLlmResponse("click", { selector: "btn1" }),
        blocked: false,
        actionResult: "clicked btn1",
      });

      transcript.addTurn({
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("click", { selector: "btn2" }),
        selectedAction: createLlmResponse("click", { selector: "btn2" }),
        executedAction: createLlmResponse("click", { selector: "btn2" }),
        blocked: false,
        actionResult: "clicked btn2",
      });

      expect(transcript.getTurns()[0].turn).toBe(1);
      expect(transcript.getTurns()[1].turn).toBe(2);
    });

    it("records LLM errors as blocked turns", () => {
      const pageState = createMockPageState();

      transcript.addTurn({
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        blocked: true,
        blockReason: "LLM error: service unavailable",
      });

      const turns = transcript.getTurns();
      expect(turns[0].blocked).toBe(true);
      expect(turns[0].blockReason).toBe("LLM error: service unavailable");
    });
  });

  describe("JSON serialization", () => {
    it("produces valid JSON with all turns and metadata", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      transcript.addTurn({
        turn: 1,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
        selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
        executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
        blocked: false,
        actionResult: "navigated to https://app.example.com",
      });

      const json = transcript.toJson();
      const parsed = JSON.parse(json);

      expect(parsed.url).toBe("https://example.com");
      expect(parsed.goal).toBe("Test goal");
      expect(parsed.totalTurns).toBe(1);
      expect(parsed.blockedTurns).toBe(0);
      expect(parsed.turns.length).toBe(1);
      expect(parsed.turns[0].turn).toBe(1);
      expect(parsed.turns[0].startTime).toBe(baseTime.toISOString());
      expect(parsed.turns[0].pageState).toEqual(pageState);
      expect(parsed.turns[0].llmRequest).toEqual([{ role: "user", content: "test" }]);
      expect(parsed.turns[0].llmResponse).toEqual(createLlmResponse("goto", { url: "https://app.example.com" }));
    });

    it("includes elapsed time in JSON output", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      transcript.addTurn({
        turn: 1,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("done"),
        selectedAction: createLlmResponse("done"),
        executedAction: createLlmResponse("done"),
        blocked: false,
        actionResult: "exploration done",
      });

      transcript.setElapsed(5000);
      transcript.setCompleted(true);
      transcript.setStopReason("done");

      const json = transcript.toJson();
      const parsed = JSON.parse(json);

      expect(parsed.elapsed).toBe(5000);
      expect(parsed.completed).toBe(true);
      expect(parsed.stopReason).toBe("done");
    });

    it("produces valid JSON that can be parsed without errors", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      // Add multiple turns with complex data
      for (let i = 0; i < 10; i++) {
        transcript.addTurn({
          turn: i + 1,
          startTime: new Date(baseTime.getTime() + i * 1000).toISOString(),
          pageState: {
            ...pageState,
            url: `https://example.com/page${i}`,
            title: `Page ${i}`,
            axTree: [
              { role: "heading", name: `Heading ${i}`, tag: "h1", depth: 1, interactive: false },
              { role: "button", name: `Button ${i}`, tag: "button", depth: 2, interactive: true, selector: `button${i}` },
            ],
            selectors: [`button${i}`],
            formFields: [
              { selector: `input${i}`, name: `field${i}`, type: "text", value: "", required: false },
            ],
          },
          systemPrompt: `System prompt for turn ${i}`,
          llmRequest: [
            { role: "system" as const, content: `System prompt for turn ${i}` },
            { role: "user" as const, content: `User message ${i}` },
          ],
          llmResponse: createLlmResponse("click", { selector: `button${i}` }, `Narration ${i}`, `Notes ${i}`),
          selectedAction: createLlmResponse("click", { selector: `button${i}` }),
          executedAction: createLlmResponse("click", { selector: `button${i}` }),
          blocked: i % 3 === 0,
          blockReason: i % 3 === 0 ? "blocked by guardrail" : undefined,
          actionResult: `clicked button${i}`,
        });
      }

      const json = transcript.toJson();
      const parsed = JSON.parse(json);
      expect(parsed.turns.length).toBe(10);
    });
  });

  describe("file persistence", () => {
    beforeEach(ensureTransientDir);
    afterEach(() => {
      try { cleanupTransientDir(); } catch { /* ignore */ }
    });

    it("saves transcript to .demoforge/transcript/ directory", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      transcript.addTurn({
        turn: 1,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("goto", { url: "https://example.com" }),
        selectedAction: createLlmResponse("goto", { url: "https://example.com" }),
        executedAction: createLlmResponse("goto", { url: "https://example.com" }),
        blocked: false,
        actionResult: "navigated",
      });

      const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.url).toBe("https://example.com");
      expect(parsed.goal).toBe("Test goal");
      expect(parsed.turns.length).toBe(1);
    });

    it("loads transcript from file", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      transcript.addTurn({
        turn: 1,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("goto", { url: "https://example.com" }),
        selectedAction: createLlmResponse("goto", { url: "https://example.com" }),
        executedAction: createLlmResponse("goto", { url: "https://example.com" }),
        blocked: false,
        actionResult: "navigated",
      });

      const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
      const loaded = loadTranscriptFromFile(filePath);

      expect(loaded.url).toBe("https://example.com");
      expect(loaded.goal).toBe("Test goal");
      expect(loaded.turns.length).toBe(1);
      expect(loaded.totalTurns).toBe(1);
    });

    it("generates filename with URL and timestamp", () => {
      transcript = new Transcript({
        url: "https://app.example.com/login",
        goal: "Login flow",
      });

      const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
      const fileName = require("node:path").basename(filePath);

      expect(fileName).toContain("app-example-com-login");
      expect(fileName).toMatch(/\.json$/);
    });

    it("creates transcript directory if it does not exist", () => {
      const nestedDir = join(TRANSIENT_DIR, "nested", "deep");
      const filePath = saveTranscriptToFile(transcript, nestedDir);
      expect(existsSync(filePath)).toBe(true);
    });

    it("returns the file path from saveTranscriptToFile", () => {
      const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
      expect(typeof filePath).toBe("string");
      expect(filePath).toContain(".json");
    });
  });
});

describe("truncateContent", () => {
  it("truncates long strings to max length with ellipsis", () => {
    const longStr = "a".repeat(1000);
    const truncated = truncateContent(longStr, 100);
    expect(truncated.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(truncated.endsWith("...")).toBe(true);
    expect(truncated.startsWith("a")).toBe(true);
  });

  it("does not truncate short strings", () => {
    const shortStr = "hello";
    const result = truncateContent(shortStr, 100);
    expect(result).toBe("hello");
  });

  it("does not truncate strings at exactly max length", () => {
    const exactStr = "a".repeat(100);
    const result = truncateContent(exactStr, 100);
    expect(result).toBe(exactStr);
  });

  it("handles non-string input by converting to string", () => {
    expect(truncateContent(123, 10)).toBe("123");
    expect(truncateContent(null, 10)).toBe("null");
    expect(truncateContent(undefined, 10)).toBe("undefined");
  });

  it("handles objects by converting to string", () => {
    const obj = { key: "value" };
    const result = truncateContent(obj, 50);
    expect(result).toBe('[object Object]');
  });
});

describe("ScriptAssembly", () => {
  describe("assembling steps from turns", () => {
    it("converts successful turns into demo steps", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: "button[data-testid='sign-in']" }),
          selectedAction: createLlmResponse("click", { selector: "button[data-testid='sign-in']" }),
          executedAction: createLlmResponse("click", { selector: "button[data-testid='sign-in']" }),
          blocked: false,
          actionResult: "clicked button",
        },
        {
          turn: 3,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      expect(result.valid).toBe(true);
      expect(result.script.steps.length).toBeGreaterThan(0);
    });

    it("skips blocked turns in the assembled script", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: "delete-account" }),
          selectedAction: createLlmResponse("click", { selector: "delete-account" }),
          blocked: true,
          blockReason: "destructive action",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      expect(result.valid).toBe(true);

      // The blocked turn should not produce a step
      const gotoSteps = result.script.steps.filter((s) => "goto" in s);
      expect(gotoSteps.length).toBe(1);
    });

    it("adds a done step at the end if missing", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      const doneSteps = result.script.steps.filter((s) => "done" in s);
      expect(doneSteps.length).toBe(1);
      expect(doneSteps[0].done).toBe(true);
    });

    it("validates the assembled script against the schema", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      expect(result.valid).toBe(true);

      // Verify the script validates independently
      const validation = validateDemoScript(result.script);
      expect(validation.success).toBe(true);
    });

    it("handles narration steps correctly", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("narrate", {}, "Welcome to the app", "Intro narration"),
          selectedAction: createLlmResponse("narrate", {}, "Welcome to the app"),
          executedAction: createLlmResponse("narrate", {}, "Welcome to the app"),
          blocked: false,
          actionResult: "narration: Welcome to the app",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "captions",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      const narrateSteps = result.script.steps.filter((s) => "narrate" in s);
      expect(narrateSteps.length).toBe(1);
      expect(narrateSteps[0].narrate).toBe("Welcome to the app");
    });

    it("handles fill steps with target and value", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
          selectedAction: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
          executedAction: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
          blocked: false,
          actionResult: 'filled input[name="email"] with "user@example.com"',
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      const fillSteps = result.script.steps.filter((s) => "fill" in s);
      expect(fillSteps.length).toBe(1);
      expect(fillSteps[0].fill).toEqual({ target: "input[name='email']", value: "user@example.com" });
    });

    it("handles mark_flow_start and mark_flow_end steps", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("mark_flow_start", { name: "Login Flow" }),
          selectedAction: createLlmResponse("mark_flow_start", { name: "Login Flow" }),
          executedAction: createLlmResponse("mark_flow_start", { name: "Login Flow" }),
          blocked: false,
          actionResult: "flow started: Login Flow",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com/login" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com/login" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com/login" }),
          blocked: false,
          actionResult: "navigated",
        },
        {
          turn: 3,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("mark_flow_end", { name: "Login Flow" }),
          selectedAction: createLlmResponse("mark_flow_end", { name: "Login Flow" }),
          executedAction: createLlmResponse("mark_flow_end", { name: "Login Flow" }),
          blocked: false,
          actionResult: "flow ended: Login Flow",
        },
        {
          turn: 4,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      const startSteps = result.script.steps.filter((s) => "mark_flow_start" in s);
      const endSteps = result.script.steps.filter((s) => "mark_flow_end" in s);
      expect(startSteps.length).toBe(1);
      expect(startSteps[0].mark_flow_start).toEqual({ name: "Login Flow" });
      expect(endSteps.length).toBe(1);
      expect(endSteps[0].mark_flow_end).toEqual({ name: "Login Flow" });
    });

    it("handles screenshot steps", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("screenshot"),
          selectedAction: createLlmResponse("screenshot"),
          executedAction: createLlmResponse("screenshot"),
          blocked: false,
          actionResult: "screenshot taken (64 bytes)",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Test Demo",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      const screenshotSteps = result.script.steps.filter((s) => "screenshot" in s);
      expect(screenshotSteps.length).toBe(1);
      expect(screenshotSteps[0].screenshot).toEqual({});
    });

    it("builds a valid Demo Script from a full transcript", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("narrate", {}, "Welcome to DemoForge", "Intro"),
          selectedAction: createLlmResponse("narrate", {}, "Welcome to DemoForge"),
          executedAction: createLlmResponse("narrate", {}, "Welcome to DemoForge"),
          blocked: false,
          actionResult: "narration: Welcome to DemoForge",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
        {
          turn: 3,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("mark_flow_start", { name: "Main Flow" }),
          selectedAction: createLlmResponse("mark_flow_start", { name: "Main Flow" }),
          executedAction: createLlmResponse("mark_flow_start", { name: "Main Flow" }),
          blocked: false,
          actionResult: "flow started: Main Flow",
        },
        {
          turn: 4,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("click", { selector: "button[data-testid='features']" }),
          selectedAction: createLlmResponse("click", { selector: "button[data-testid='features']" }),
          executedAction: createLlmResponse("click", { selector: "button[data-testid='features']" }),
          blocked: false,
          actionResult: "clicked button",
        },
        {
          turn: 5,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("fill", { selector: "input[name='search']", value: "demo" }),
          selectedAction: createLlmResponse("fill", { selector: "input[name='search']", value: "demo" }),
          executedAction: createLlmResponse("fill", { selector: "input[name='search']", value: "demo" }),
          blocked: false,
          actionResult: 'filled input[name="search"] with "demo"',
        },
        {
          turn: 6,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("mark_flow_end", { name: "Main Flow" }),
          selectedAction: createLlmResponse("mark_flow_end", { name: "Main Flow" }),
          executedAction: createLlmResponse("mark_flow_end", { name: "Main Flow" }),
          blocked: false,
          actionResult: "flow ended: Main Flow",
        },
        {
          turn: 7,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Full Demo",
        narration_mode: "captions",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();

      expect(result.valid).toBe(true);
      expect(result.script.title).toBe("Full Demo");
      expect(result.script.narration_mode).toBe("captions");
      expect(result.script.steps.length).toBe(7); // 6 actions + auto done

      // Verify validation
      const validation = validateDemoScript(result.script);
      expect(validation.success).toBe(true);
    });
  });

  describe("buildDemoScriptFromTranscript", () => {
    it("is a convenience wrapper around ScriptAssembly", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns: Array<Partial<import("./types.js").ExplorationTurn>> = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
          selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
          blocked: false,
          actionResult: "navigated",
        },
        {
          turn: 2,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const result = buildDemoScriptFromTranscript(turns as import("./types.js").ExplorationTurn[], {
        title: "Demo",
        narration_mode: "none",
      });

      expect(result.valid).toBe(true);
      expect(result.script.steps.length).toBeGreaterThan(0);
    });
  });

  describe("viewport configuration", () => {
    it("includes viewport in the assembled script", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Viewport Test",
        narration_mode: "none",
        viewport: { width: 1920, height: 1080, scale: 2 },
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      expect(result.script.viewport).toEqual({ width: 1920, height: 1080, scale: 2 });
    });

    it("defaults viewport scale to 1 when not specified", () => {
      const pageState = createMockPageState();
      const baseTime = new Date("2024-01-01T00:00:00Z");

      const turns = [
        {
          turn: 1,
          startTime: baseTime.toISOString(),
          pageState,
          systemPrompt: "System prompt",
          llmRequest: [{ role: "user" as const, content: "test" }],
          llmResponse: createLlmResponse("done"),
          selectedAction: createLlmResponse("done"),
          executedAction: createLlmResponse("done"),
          blocked: false,
          actionResult: "done",
        },
      ];

      const assembly = new ScriptAssembly({
        title: "Viewport Default",
        narration_mode: "none",
      });

      for (const turn of turns) {
        assembly.addTurn(turn);
      }

      const result = assembly.assemble();
      expect(result.script.viewport).toEqual({ width: 1280, height: 720, scale: 1 });
    });
  });
});

describe("HumanConfirmUI", () => {
  describe("presenting proposed flows", () => {
    it("presents flows to the confirmation callback", async () => {
      let receivedFlows: string[] = [];
      const ui = new HumanConfirmUI({
        onConfirm: (flows: string[]) => {
          receivedFlows = flows;
          return Promise.resolve({ decision: "accept", selectedFlows: flows });
        },
      });

      const result = await ui.present(["Flow 1", "Flow 2", "Flow 3"]);

      expect(result.decision).toBe("accept");
      expect(result.selectedFlows).toEqual(["Flow 1", "Flow 2", "Flow 3"]);
      expect(receivedFlows).toEqual(["Flow 1", "Flow 2", "Flow 3"]);
    });

    it("returns accept decision when callback returns selected flows", async () => {
      let receivedFlows: string[] = [];
      const ui = new HumanConfirmUI({
        onConfirm: (flows: string[]) => {
          receivedFlows = flows;
          return Promise.resolve({ decision: "accept", selectedFlows: ["Flow 1"] });
        },
      });

      const result = await ui.present(["Flow 1", "Flow 2"]);

      expect(result.decision).toBe("accept");
      expect(result.selectedFlows).toEqual(["Flow 1"]);
      expect(result.confirmed).toBe(true);
    });

    it("returns reject decision when callback returns empty array", async () => {
      const ui = new HumanConfirmUI({
        onConfirm: () => Promise.resolve({ decision: "reject", selectedFlows: [] }),
      });

      const result = await ui.present(["Flow 1", "Flow 2"]);

      expect(result.decision).toBe("reject");
      expect(result.selectedFlows).toEqual([]);
      expect(result.confirmed).toBe(false);
    });

    it("returns modify decision with modified flows", async () => {
      const ui = new HumanConfirmUI({
        onConfirm: () => Promise.resolve({ decision: "modify", selectedFlows: ["Flow 1 modified"] }),
      });

      const result = await ui.present(["Flow 1", "Flow 2"]);

      expect(result.decision).toBe("modify");
      expect(result.selectedFlows).toEqual(["Flow 1 modified"]);
      expect(result.confirmed).toBe(true);
    });

    it("handles empty flow list gracefully", async () => {
      const ui = new HumanConfirmUI({
        onConfirm: () => Promise.resolve({ decision: "accept", selectedFlows: [] }),
      });

      const result = await ui.present([]);

      expect(result.decision).toBe("accept");
      expect(result.selectedFlows).toEqual([]);
    });

    it("passes flow descriptions to the callback", async () => {
      let lastFlows: string[] = [];
      const ui = new HumanConfirmUI({
        onConfirm: (flows: string[]) => {
          lastFlows = flows;
          return Promise.resolve({ decision: "accept", selectedFlows: flows });
        },
      });

      const detailedFlows = [
        "Homepage -> Features -> Pricing",
        "Login -> Dashboard -> Settings",
      ];

      await ui.present(detailedFlows);

      expect(lastFlows).toEqual(detailedFlows);
    });
  });
});

describe("Integration: full transcript lifecycle", () => {
  beforeEach(ensureTransientDir);
  afterEach(() => {
    try { cleanupTransientDir(); } catch { /* ignore */ }
  });

  it("creates, populates, serializes, saves, loads, and verifies a complete transcript", () => {
    const transcript = new Transcript({
      url: "https://app.example.com",
      goal: "Demo login flow",
    });

    const pageState = createMockPageState("https://app.example.com", "App Home");
    const baseTime = new Date("2024-01-01T00:00:00Z");

    // Add turns
    transcript.addTurn({
      turn: 1,
      startTime: baseTime.toISOString(),
      pageState,
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("narrate", {}, "Welcome to the app", "Intro"),
      selectedAction: createLlmResponse("narrate", {}, "Welcome to the app"),
      executedAction: createLlmResponse("narrate", {}, "Welcome to the app"),
      blocked: false,
      actionResult: "narration: Welcome to the app",
    });

    transcript.addTurn({
      turn: 2,
      startTime: new Date(baseTime.getTime() + 1000).toISOString(),
      pageState,
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("goto", { url: "https://app.example.com/login" }),
      selectedAction: createLlmResponse("goto", { url: "https://app.example.com/login" }),
      executedAction: createLlmResponse("goto", { url: "https://app.example.com/login" }),
      blocked: false,
      actionResult: "navigated to https://app.example.com/login",
    });

    transcript.addTurn({
      turn: 3,
      startTime: new Date(baseTime.getTime() + 2000).toISOString(),
      pageState: createMockPageState("https://app.example.com/login", "Login"),
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
      selectedAction: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
      executedAction: createLlmResponse("fill", { selector: "input[name='email']", value: "user@example.com" }),
      blocked: false,
      actionResult: 'filled input[name="email"] with "user@example.com"',
    });

    transcript.addTurn({
      turn: 4,
      startTime: new Date(baseTime.getTime() + 3000).toISOString(),
      pageState: createMockPageState("https://app.example.com/login", "Login"),
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("click", { selector: "button[type='submit']" }),
      selectedAction: createLlmResponse("click", { selector: "button[type='submit']" }),
      executedAction: createLlmResponse("click", { selector: "button[type='submit']" }),
      blocked: false,
      actionResult: "clicked button[type='submit']",
    });

    transcript.addTurn({
      turn: 5,
      startTime: new Date(baseTime.getTime() + 4000).toISOString(),
      pageState: createMockPageState("https://app.example.com/dashboard", "Dashboard"),
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("done"),
      selectedAction: createLlmResponse("done"),
      executedAction: createLlmResponse("done"),
      blocked: false,
      actionResult: "done",
    });

    transcript.setElapsed(5000);
    transcript.setCompleted(true);
    transcript.setStopReason("done");

    // Save to file
    const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
    expect(existsSync(filePath)).toBe(true);

    // Load from file
    const loaded = loadTranscriptFromFile(filePath);
    expect(loaded.url).toBe("https://app.example.com");
    expect(loaded.goal).toBe("Demo login flow");
    expect(loaded.turns.length).toBe(5);
    expect(loaded.totalTurns).toBe(5);
    expect(loaded.completed).toBe(true);
    expect(loaded.stopReason).toBe("done");
    expect(loaded.elapsed).toBe(5000);

    // Verify each loaded turn has complete data
    for (const turn of loaded.turns) {
      expect(turn.turn).toBeDefined();
      expect(turn.startTime).toBeDefined();
      expect(turn.pageState).toBeDefined();
      expect(turn.systemPrompt).toBeDefined();
      expect(turn.llmRequest).toBeDefined();
      expect(turn.blocked).toBeDefined();
    }

    // Assemble script from loaded transcript
    const assembly = new ScriptAssembly({
      title: "Login Demo",
      narration_mode: "captions",
    });

    for (const turn of loaded.turns) {
      assembly.addTurn(turn);
    }

    const result = assembly.assemble();
    expect(result.valid).toBe(true);
    expect(result.script.steps.length).toBeGreaterThan(0);

    const validation = validateDemoScript(result.script);
    expect(validation.success).toBe(true);
  });

  it("handles transcript with blocked turns in the full lifecycle", () => {
    const transcript = new Transcript({
      url: "https://app.example.com",
      goal: "Test with blocks",
    });

    const pageState = createMockPageState();
    const baseTime = new Date("2024-01-01T00:00:00Z");

    transcript.addTurn({
      turn: 1,
      startTime: baseTime.toISOString(),
      pageState,
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("click", { selector: "delete-account" }),
      selectedAction: createLlmResponse("click", { selector: "delete-account" }),
      blocked: true,
      blockReason: "blocked: destructive button",
    });

    transcript.addTurn({
      turn: 2,
      startTime: new Date(baseTime.getTime() + 1000).toISOString(),
      pageState,
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("goto", { url: "https://app.example.com" }),
      selectedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
      executedAction: createLlmResponse("goto", { url: "https://app.example.com" }),
      blocked: false,
      actionResult: "navigated",
    });

    transcript.addTurn({
      turn: 3,
      startTime: new Date(baseTime.getTime() + 2000).toISOString(),
      pageState,
      systemPrompt: "System prompt",
      llmRequest: [{ role: "user" as const, content: "test" }],
      llmResponse: createLlmResponse("done"),
      selectedAction: createLlmResponse("done"),
      executedAction: createLlmResponse("done"),
      blocked: false,
      actionResult: "done",
    });

    const filePath = saveTranscriptToFile(transcript, TRANSIENT_DIR);
    const loaded = loadTranscriptFromFile(filePath);

    expect(loaded.totalTurns).toBe(3);
    expect(loaded.blockedTurns).toBe(1);

    const assembly = new ScriptAssembly({
      title: "Blocked Test",
      narration_mode: "none",
    });

    for (const turn of loaded.turns) {
      assembly.addTurn(turn);
    }

    const result = assembly.assemble();
    expect(result.valid).toBe(true);

    // Only the non-blocked turns should be in the script
    const gotoSteps = result.script.steps.filter((s) => "goto" in s);
    expect(gotoSteps.length).toBe(1);
    const doneSteps = result.script.steps.filter((s) => "done" in s);
    expect(doneSteps.length).toBe(1);
  });
});

describe("createTranscriptDir", () => {
  it("creates the .demoforge/transcript directory", () => {
    const dir = join(TRANSIENT_DIR, "create-test");
    const result = createTranscriptDir(dir);
    expect(existsSync(result)).toBe(true);
  });
});

describe("ScriptAssembly with invalid actions", () => {
  it("skips turns with no selectedAction", () => {
    const pageState = createMockPageState();
    const baseTime = new Date("2024-01-01T00:00:00Z");

    const turns = [
      {
        turn: 1,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        blocked: false,
        actionResult: "no action",
      } as unknown as import("./types.js").ExplorationTurn,
      {
        turn: 2,
        startTime: baseTime.toISOString(),
        pageState,
        systemPrompt: "System prompt",
        llmRequest: [{ role: "user" as const, content: "test" }],
        llmResponse: createLlmResponse("done"),
        selectedAction: createLlmResponse("done"),
        executedAction: createLlmResponse("done"),
        blocked: false,
        actionResult: "done",
      },
    ];

    const assembly = new ScriptAssembly({
      title: "Test Demo",
      narration_mode: "none",
    });

    for (const turn of turns) {
      assembly.addTurn(turn);
    }

    const result = assembly.assemble();
    expect(result.valid).toBe(true);
    const doneSteps = result.script.steps.filter((s) => "done" in s);
    expect(doneSteps.length).toBe(1);
  });
});
