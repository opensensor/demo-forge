/**
 * Tests for the explorer agent — agent loop.
 *
 * Tests cover:
 * - Multi-step flow execution (goto -> click -> fill -> click -> wait_for)
 * - JSON schema constraint prevents invalid action types
 * - Step budget stops exploration after N steps
 * - Destructive action blocked by guardrails
 * - Exploration transcript completeness
 * - Output Demo Script validates against schema
 * - Discovery mode proposes flows and waits for confirmation
 * - Progress reporter shows turn-by-turn status
 */

import { describe, it, expect } from "vitest";
import { validateDemoScript } from "../schema/demoScriptSchema.js";
import type {
  ExplorerConfig,
  ExplorerActionType,
  LlmActionResponse,
  LlmClient,
  ProgressReporter,
  ProgressEvent,
  ExplorationTurn,
  ExplorationTranscript,
  ExplorationResult,
  GuardrailsConfig,
} from "./types.js";
import { ExplorerAgent } from "./agent-loop.js";
import type { BrowserSession } from "@demoforge/browser";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockLlmClient(
  responses: LlmActionResponse[],
  blockActions: string[] = []
): LlmClient {
  let callIndex = 0;
  return {
    async sendAction(
      _systemPrompt: string,
      _messages: unknown[],
      _actionSchema: Record<string, unknown>
    ): Promise<LlmActionResponse> {
      if (callIndex >= responses.length) {
        return { action: "done", params: {}, notes: "No more actions" };
      }
      const response = responses[callIndex++];
      return { ...response };
    },
    get callCount() {
      return callIndex;
    },
    get responses() {
      return responses;
    },
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

function createMockBrowser() {
  const actions: Array<{ type: string; args: unknown[] }> = [];
  const pages: string[] = [];
  const fills: Array<{ selector: string; value: string }> = [];
  const clicks: string[] = [];
  const hovers: string[] = [];
  const waits: unknown[] = [];
  const screenshots: unknown[] = [];
  const states: Array<{
    url: string;
    title: string;
    viewport: { width: number; height: number };
    pageCount: number;
    isRunning: boolean;
  }> = [];

  return {
    actions,
    pages,
    fills,
    clicks,
    hovers,
    waits,
    screenshots,
    states,
    async goto(url: string): Promise<void> {
      pages.push(url);
      actions.push({ type: "goto", args: [url] });
    },
    async click(selector: string): Promise<void> {
      clicks.push(selector);
      actions.push({ type: "click", args: [selector] });
    },
    async hover(selector: string): Promise<void> {
      hovers.push(selector);
      actions.push({ type: "hover", args: [selector] });
    },
    async fill(selector: string, value: string): Promise<void> {
      fills.push({ selector, value });
      actions.push({ type: "fill", args: [selector, value] });
    },
    async select(_selector: string, _value: string): Promise<void> {
      actions.push({ type: "select", args: [_selector, _value] });
    },
    async press(_key: string): Promise<void> {
      actions.push({ type: "press", args: [_key] });
    },
    async scroll(_options: unknown): Promise<void> {
      actions.push({ type: "scroll", args: [_options] });
    },
    async wait_for(_options: unknown): Promise<void> {
      waits.push(_options);
      actions.push({ type: "wait_for", args: [_options] });
    },
    async screenshot(_options?: unknown): Promise<Buffer> {
      screenshots.push(_options);
      return Buffer.from("screenshot");
    },
    async getState() {
      const state = {
        url: pages[pages.length - 1] || "",
        title: "Test Page",
        viewport: { width: 1280, height: 720 },
        pageCount: 1,
        isRunning: true,
      };
      states.push(state);
      return state;
    },
    async launch(): Promise<void> {
      // no-op for tests
    },
    async close(): Promise<void> {
      // no-op for tests
    },
  };
}

function createMockPageState(
  url = "https://example.com",
  title = "Example"
): Record<string, unknown> {
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
      {
        role: "link",
        name: "Learn More",
        tag: "a",
        depth: 2,
        interactive: true,
        selector: "a[data-testid='learn-more']",
      },
    ],
    selectors: [
      "button[data-testid='sign-in']",
      "a[data-testid='learn-more']",
    ],
    formFields: [],
  };
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe("ExplorerAgent", () => {
  describe("multi-step flow execution", () => {
    it("executes a goto -> click -> fill -> click -> wait_for flow", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        { action: "goto", params: { url: "https://app.example.com/login" }, notes: "Navigate to login" },
        { action: "click", params: { selector: "button[data-testid='sign-in']" }, notes: "Click sign in" },
        {
          action: "fill",
          params: { selector: "input[name='email']", value: "user@example.com" },
          notes: "Fill email",
        },
        {
          action: "fill",
          params: { selector: "input[name='password']", value: "secret123" },
          notes: "Fill password",
        },
        { action: "click", params: { selector: "button[type='submit']" }, notes: "Submit form" },
        {
          action: "wait_for",
          params: { text: "Welcome" },
          notes: "Wait for welcome message",
        },
        { action: "done", params: {}, notes: "Flow complete" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Demonstrate login flow",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Login Demo", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      expect(result.success).toBe(true);
      expect(result.script.steps.length).toBeGreaterThan(0);
      expect(result.stopReason).toBe("done");

      // Verify browser actions were called
      expect(mockBrowser.pages).toContain("https://app.example.com/login");
      expect(mockBrowser.clicks).toContain("button[data-testid='sign-in']");
      expect(mockBrowser.fills).toContainEqual({
        selector: "input[name='email']",
        value: "user@example.com",
      });
      expect(mockBrowser.fills).toContainEqual({
        selector: "input[name='password']",
        value: "secret123",
      });

      // Verify transcript has turns
      expect(result.transcript.turns.length).toBeGreaterThan(0);
      expect(result.transcript.totalTurns).toBeGreaterThan(0);
    });
  });

  describe("JSON schema constraint", () => {
    it("rejects invalid action types from LLM response", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        { action: "goto", params: { url: "https://example.com" }, notes: "Go somewhere" },
        { action: "invalid_action_xyz" as ExplorerActionType, params: {}, notes: "Bad action" },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test invalid action",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Invalid Action Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      // The invalid action should be blocked, and exploration should continue
      expect(result.transcript.turns.length).toBeGreaterThanOrEqual(2);
      const invalidTurn = result.transcript.turns.find((t) => t.blocked);
      expect(invalidTurn).toBeDefined();
      expect(invalidTurn!.blockReason).toContain("invalid");
    });

    it("only accepts valid action types from the defined set", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const validActions: ExplorerActionType[] = [
        "goto", "click", "hover", "fill", "select", "press",
        "scroll", "wait_for", "narrate", "screenshot",
        "mark_flow_start", "mark_flow_end", "done", "pause",
      ];

      for (const actionType of validActions) {
        const responses: LlmActionResponse[] = [
          {
            action: actionType,
            params: actionType === "goto" ? { url: "https://example.com" } : {},
            notes: `Test ${actionType}`,
          },
          { action: "done", params: {}, notes: "Done" },
        ];

        const llmClient = createMockLlmClient(responses);

        const agent = new ExplorerAgent({
          url: "https://example.com",
          goal: `Test action: ${actionType}`,
          maxSteps: 5,
          maxTime: 30000,
          viewport: { width: 1280, height: 720 },
          reporter,
          llmClient,
          scriptTemplate: { title: `Action Test: ${actionType}`, narration_mode: "none" },
          requireConfirmation: false,
          browser: mockBrowser as any,
        });

        const result = await agent.run();
        expect(result.success).toBe(true);
      }
    });
  });

  describe("step budget", () => {
    it("stops exploration after maxSteps is reached", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [];
      for (let i = 0; i < 10; i++) {
        responses.push({
          action: "goto",
          params: { url: `https://example.com/page${i}` },
          notes: `Page ${i}`,
        });
      }

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test step budget",
        maxSteps: 3,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Step Budget Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      expect(result.stopReason).toBe("max_steps");
      expect(result.transcript.turns.length).toBe(3);
      expect(result.transcript.totalTurns).toBe(3);

      // Verify budget exceeded event was reported
      const budgetEvents = reporter.events.filter(
        (e) => e.type === "budget_exceeded"
      );
      expect(budgetEvents.length).toBeGreaterThan(0);
    });
  });

  describe("destructive action blocking", () => {
    it("blocks actions on destructive button patterns", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "click",
          params: { selector: "button[data-testid='delete-account']" },
          notes: "Click delete account",
        },
        {
          action: "click",
          params: { selector: "button[data-testid='reset-database']" },
          notes: "Click reset database",
        },
        {
          action: "click",
          params: { selector: "button[data-testid='submit']" },
          notes: "Click submit",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const guardrails: GuardrailsConfig = {
        destructiveButtonPatterns: [
          "delete account",
          "reset database",
          "empty database",
          "permanently delete",
          "wipe data",
        ],
      };

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test guardrails",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Guardrails Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
        guardrails,
      });

      const result = await agent.run();

      // Verify destructive actions were blocked
      const blockedTurns = result.transcript.turns.filter((t) => t.blocked);
      expect(blockedTurns.length).toBe(2);

      // Verify the submit action was executed
      const executedTurns = result.transcript.turns.filter((t) => !t.blocked);
      expect(executedTurns.length).toBeGreaterThan(0);

      // Verify progress events for blocked actions
      const blockedEvents = reporter.events.filter(
        (e) => e.type === "action_blocked"
      );
      expect(blockedEvents.length).toBe(2);
    });

    it("blocks navigation to destructive URLs", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com/admin/delete-all" },
          notes: "Navigate to delete all",
        },
        {
          action: "goto",
          params: { url: "https://example.com/dashboard" },
          notes: "Navigate to dashboard",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const guardrails: GuardrailsConfig = {
        destructiveUrlPatterns: [
          "/admin/delete",
          "/admin/reset",
          "/api/wipe",
        ],
      };

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test URL guardrails",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "URL Guardrails Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
        guardrails,
      });

      const result = await agent.run();

      const blockedTurns = result.transcript.turns.filter((t) => t.blocked);
      expect(blockedTurns.length).toBe(1);
      expect(blockedTurns[0].blockReason).toContain("destructive");
    });
  });

  describe("exploration transcript", () => {
    it("records complete turn-by-turn log for debugging", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com/login" },
          notes: "Go to login page",
        },
        {
          action: "click",
          params: { selector: "button[data-testid='sign-in']" },
          notes: "Click sign in",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test transcript completeness",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Transcript Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      // Verify transcript structure
      const transcript = result.transcript;
      expect(transcript.url).toBe("https://example.com");
      expect(transcript.goal).toBe("Test transcript completeness");
      expect(transcript.turns.length).toBe(3);
      expect(transcript.totalTurns).toBe(3);
      expect(transcript.blockedTurns).toBe(0);
      expect(transcript.completed).toBe(true);
      expect(transcript.stopReason).toBe("done");

      // Verify each turn has required fields
      for (const turn of transcript.turns) {
        expect(turn.turn).toBeDefined();
        expect(turn.startTime).toBeDefined();
        expect(turn.pageState).toBeDefined();
        expect(turn.pageState.url).toBeDefined();
        expect(turn.pageState.title).toBeDefined();
        expect(turn.pageState.axTree).toBeDefined();
        expect(turn.pageState.selectors).toBeDefined();
        expect(turn.systemPrompt).toBeDefined();
        expect(turn.systemPrompt.length).toBeGreaterThan(0);
        expect(turn.llmRequest).toBeDefined();
        expect(turn.llmRequest.length).toBeGreaterThan(0);
        expect(turn.llmResponse).toBeDefined();
        expect(turn.selectedAction).toBeDefined();
        expect(turn.blocked).toBeDefined();
        expect(turn.actionResult).toBeDefined();
      }

      // Verify timestamps are ordered
      for (let i = 1; i < transcript.turns.length; i++) {
        const prev = new Date(transcript.turns[i - 1].startTime).getTime();
        const curr = new Date(transcript.turns[i].startTime).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("records blocked actions with reasons in transcript", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "click",
          params: { selector: "button[data-testid='delete-account']" },
          notes: "Click delete",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test blocked action recording",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Blocked Action Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
        guardrails: {
          destructiveButtonPatterns: ["delete account"],
        },
      });

      const result = await agent.run();

      const blockedTurn = result.transcript.turns.find((t) => t.blocked);
      expect(blockedTurn).toBeDefined();
      expect(blockedTurn!.blockReason).toBeDefined();
      expect(blockedTurn!.blockReason!.length).toBeGreaterThan(0);
      expect(blockedTurn!.executedAction).toBeUndefined();
      expect(blockedTurn!.actionResult).toBeUndefined();
    });
  });

  describe("script assembly", () => {
    it("assembles steps into a valid Demo Script", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://app.example.com" },
          notes: "Go to app",
        },
        {
          action: "click",
          params: { selector: "button[data-testid='features']" },
          notes: "Click features",
        },
        {
          action: "fill",
          params: {
            selector: "input[name='search']",
            value: "demo feature",
          },
          notes: "Search for demo",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test script assembly",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720, scale: 1 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Assembly Test Demo",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      // Verify script was assembled
      expect(result.script).toBeDefined();
      expect(result.script.title).toBe("Assembly Test Demo");
      expect(result.script.narration_mode).toBe("none");
      expect(result.script.steps.length).toBeGreaterThan(0);

      // Verify script validates against schema
      const validation = validateDemoScript(result.script);
      expect(validation.success).toBe(true);
    });

    it("includes narration steps in the assembled script", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "narrate",
          params: {},
          narration: "Welcome to the app",
          notes: "Add intro narration",
        },
        {
          action: "goto",
          params: { url: "https://app.example.com" },
          notes: "Go to app",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test narration steps",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720, scale: 1 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Narration Test",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      const narrateSteps = result.script.steps.filter(
        (s) => "narrate" in s
      );
      expect(narrateSteps.length).toBeGreaterThan(0);
      expect(narrateSteps[0].narrate).toBe("Welcome to the app");

      // Verify full script validates
      const validation = validateDemoScript(result.script);
      expect(validation.success).toBe(true);
    });

    it("includes a done step at the end of the script", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to page",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test done step inclusion",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720, scale: 1 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Done Step Test",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      const doneSteps = result.script.steps.filter((s) => "done" in s);
      expect(doneSteps.length).toBe(1);
      expect(doneSteps[0].done).toBe(true);
    });
  });

  describe("human confirmation", () => {
    it("proposes flows and waits for confirmation in discovery mode", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to homepage",
        },
        {
          action: "click",
          params: { selector: "a[data-testid='features']" },
          notes: "Click features",
        },
        { action: "done", params: {}, notes: "Discovery complete" },
      ];

      const llmClient = createMockLlmClient(responses);

      // Simulate human confirming the proposed flows
      const confirmedFlows = ["Homepage -> Features"];

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test discovery mode",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Discovery Test",
          narration_mode: "none",
        },
        requireConfirmation: true,
        browser: mockBrowser as any,
        confirmDiscovery: () => Promise.resolve(confirmedFlows),
      });

      const result = await agent.run();

      expect(result.confirmed).toBe(true);

      // Verify human confirmation events were reported
      const confirmRequested = reporter.events.filter(
        (e) => e.type === "human_confirm_requested"
      );
      expect(confirmRequested.length).toBeGreaterThan(0);

      const confirmReceived = reporter.events.filter(
        (e) => e.type === "human_confirm_received"
      );
      expect(confirmReceived.length).toBeGreaterThan(0);
    });

    it("stops exploration when human declines all flows", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to homepage",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      // Simulate human declining the proposed flows
      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test decline",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Decline Test", narration_mode: "none" },
        requireConfirmation: true,
        browser: mockBrowser as any,
        confirmDiscovery: () => Promise.resolve([]),
      });

      const result = await agent.run();

      expect(result.confirmed).toBe(false);
      expect(result.stopReason).toBe("declined");
    });

    it("skips confirmation when requireConfirmation is false", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to homepage",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test skip confirmation",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Skip Confirm Test",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      expect(result.success).toBe(true);

      // Verify no confirmation events were reported
      const confirmEvents = reporter.events.filter(
        (e) =>
          e.type === "human_confirm_requested" ||
          e.type === "human_confirm_received"
      );
      expect(confirmEvents.length).toBe(0);
    });
  });

  describe("progress reporter", () => {
    it("reports turn-by-turn progress events", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to page",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test progress events",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Progress Test",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      // Verify turn events were reported
      const turnStartEvents = reporter.events.filter(
        (e) => e.type === "turn_start"
      );
      const turnEndEvents = reporter.events.filter(
        (e) => e.type === "turn_end"
      );

      expect(turnStartEvents.length).toBe(result.transcript.turns.length);
      expect(turnEndEvents.length).toBe(result.transcript.turns.length);

      // Verify turn numbers are sequential
      for (let i = 0; i < turnStartEvents.length; i++) {
        expect(turnStartEvents[i].turn).toBe(i + 1);
        expect(turnEndEvents[i].turn).toBe(i + 1);
      }

      // Verify exploration_complete event was reported
      const completeEvents = reporter.events.filter(
        (e) => e.type === "exploration_complete"
      );
      expect(completeEvents.length).toBe(1);
    });

    it("reports action execution events", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        {
          action: "goto",
          params: { url: "https://example.com" },
          notes: "Go to page",
        },
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test action events",
        maxSteps: 20,
        maxTime: 60000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: {
          title: "Action Events Test",
          narration_mode: "none",
        },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      await agent.run();

      const actionEvents = reporter.events.filter(
        (e) => e.type === "action_executed"
      );
      expect(actionEvents.length).toBeGreaterThan(0);

      // Verify action type is reported
      const gotoEvent = actionEvents.find((e) => e.action === "goto");
      expect(gotoEvent).toBeDefined();
    });
  });

  describe("system prompt", () => {
    it("includes action space description in the system prompt", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);
      let capturedSystemPrompt = "";

      const originalSendAction = llmClient.sendAction.bind(llmClient);
      // We can't easily intercept, so we check the transcript instead
      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test system prompt content",
        maxSteps: 5,
        maxTime: 30000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "System Prompt Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      const turn = result.transcript.turns[0];
      const promptLower = turn.systemPrompt.toLowerCase();
      expect(promptLower).toContain("action space");
      expect(promptLower).toContain("demo goal");
      expect(promptLower).toContain("guardrails");
    });

    it("includes goal context in the system prompt", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Demonstrate user onboarding flow",
        maxSteps: 5,
        maxTime: 30000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Goal Context Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      const turn = result.transcript.turns[0];
      expect(turn.systemPrompt).toContain("Demonstrate user onboarding flow");
    });

    it("includes step and time budgets in the system prompt", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const responses: LlmActionResponse[] = [
        { action: "done", params: {}, notes: "Done" },
      ];

      const llmClient = createMockLlmClient(responses);

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test budget context",
        maxSteps: 10,
        maxTime: 30000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "Budget Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      const turn = result.transcript.turns[0];
      expect(turn.systemPrompt).toContain("10");
      expect(turn.systemPrompt).toContain("30000");
    });
  });

  describe("LLM client integration", () => {
    it("handles LLM errors gracefully", async () => {
      const reporter = createMockReporter();
      const mockBrowser = createMockBrowser();

      const llmClient: LlmClient = {
        async sendAction(
          _systemPrompt: string,
          _messages: unknown[],
          _actionSchema: Record<string, unknown>
        ): Promise<LlmActionResponse> {
          throw new Error("LLM service unavailable");
        },
      };

      const agent = new ExplorerAgent({
        url: "https://example.com",
        goal: "Test LLM error handling",
        maxSteps: 5,
        maxTime: 30000,
        viewport: { width: 1280, height: 720 },
        reporter,
        llmClient,
        scriptTemplate: { title: "LLM Error Test", narration_mode: "none" },
        requireConfirmation: false,
        browser: mockBrowser as any,
      });

      const result = await agent.run();

      expect(result.success).toBe(false);
      expect(result.stopReason).toBe("error");
      // One turn is recorded for the failed LLM call
      expect(result.transcript.turns.length).toBe(1);
      expect(result.transcript.turns[0].blocked).toBe(true);
      expect(result.transcript.turns[0].blockReason).toContain("LLM service unavailable");
    });
  });
});
