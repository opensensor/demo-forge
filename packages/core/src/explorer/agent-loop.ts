/**
 * DemoForge explorer — main exploration agent loop.
 *
 * Each turn: serialize page state -> call LLM with system prompt + action schema
 * -> parse constrained response -> execute action via browser -> record step ->
 * repeat until `done` or budget exhausted.
 *
 * System prompt includes: action space description, goal context, guardrails
 * (allowlist origin, block destructive buttons/routes), step/time budgets.
 *
 * Exploration transcript: full turn log (state sent, response received, action
 * executed) for debugging.
 *
 * Script assembly: collects all steps into valid Demo Script (validated via T2 schema).
 *
 * Human confirm step after discovery mode (proposes flows, asks for confirmation).
 *
 * Progress reporting via shared ProgressReporter interface.
 */

import { validateDemoScript } from "../schema/demoScriptSchema.js";
import { ExplorerError } from "../errors/index.js";
import type { DemoScript, DemoStep } from "../types/index.js";
import type { BrowserSession } from "@demoforge/browser";
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
  PageState,
  AccessibilityNode,
  FormField,
} from "./types.js";

// ─── Valid Action Types ──────────────────────────────────────────────────────

const VALID_ACTIONS: ReadonlySet<ExplorerActionType> = new Set<ExplorerActionType>([
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
]);

// ─── Action Schema for LLM JSON Constraint ───────────────────────────────────

/**
 * JSON schema that constrains LLM responses to valid action types.
 * This is passed as the response_format json_schema to the LLM.
 */
function buildActionSchema(): Record<string, unknown> {
  return {
    name: "explorer_action",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: Array.from(VALID_ACTIONS) as string[],
          description:
            "The action type to execute. Must be one of the valid action types.",
        },
        params: {
          type: "object",
          description: "Action parameters. Structure depends on action type.",
          additionalProperties: true,
        },
        narration: {
          type: "string",
          description: "Narration text for narrate steps.",
        },
        notes: {
          type: "string",
          description: "Notes explaining the LLM's reasoning.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  };
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

/**
 * Builds the system prompt for the explorer agent.
 * Includes action space description, goal context, guardrails, and budgets.
 */
function buildSystemPrompt(config: ExplorerConfig): string {
  const lines: string[] = [];

  // Identity and purpose
  lines.push("You are an expert web exploration agent for DemoForge.");
  lines.push("");

  // Action space description
  lines.push("## Action Space");
  lines.push("You can perform the following actions on web pages:");
  lines.push("");
  lines.push("- `goto`: Navigate to a URL. Params: { url: string }");
  lines.push("- `click`: Click an element. Params: { selector: string }");
  lines.push("- `hover`: Hover over an element. Params: { selector: string }");
  lines.push("- `fill`: Fill a form field. Params: { selector: string, value: string }");
  lines.push("- `select`: Select an option from a dropdown. Params: { selector: string, value: string }");
  lines.push("- `press`: Press a keyboard key. Params: { key: string }");
  lines.push("- `scroll`: Scroll the page. Params: { amount: number }");
  lines.push("- `wait_for`: Wait for a condition. Params: { text: string } or { selector: string }");
  lines.push("- `narrate`: Add narration text. Params: {} (use narration field for text)");
  lines.push("- `screenshot`: Take a screenshot. Params: {}");
  lines.push("- `mark_flow_start`: Mark the start of a flow. Params: { name: string }");
  lines.push("- `mark_flow_end`: Mark the end of a flow. Params: { name: string }");
  lines.push("- `pause`: Pause for a duration. Params: { duration: number }");
  lines.push("- `done`: End the exploration session. Params: {}");
  lines.push("");

  // Goal context
  lines.push("## Demo Goal");
  lines.push(`Goal: ${config.goal}`);
  lines.push("");
  lines.push("Your task is to explore the target website and demonstrate its key features.");
  lines.push("Think step by step about what actions would best showcase the product.");
  lines.push("");

  // Guardrails
  lines.push("## Guardrails");
  lines.push("You MUST follow these rules:");
  lines.push("");

  // Origin allowlist
  if (config.guardrails?.allowedOrigins && config.guardrails.allowedOrigins.length > 0) {
    lines.push(
      `- Only navigate within these origins: ${config.guardrails.allowedOrigins.join(", ")}`
    );
    lines.push("");
  }

  // Destructive action blocking
  if (config.guardrails?.destructiveButtonPatterns) {
    lines.push(
      `- NEVER click buttons matching these patterns: ${config.guardrails.destructiveButtonPatterns.join(", ")}`
    );
  }
  if (config.guardrails?.destructiveUrlPatterns) {
    lines.push(
      `- NEVER navigate to URLs matching these patterns: ${config.guardrails.destructiveUrlPatterns.join(", ")}`
    );
  }
  if (
    !config.guardrails?.destructiveButtonPatterns &&
    !config.guardrails?.destructiveUrlPatterns
  ) {
    lines.push(
      `- NEVER click destructive buttons like "Delete account", "Reset", "Empty database", "Permanently delete", or "Wipe data"`
    );
  }
  lines.push("");

  // Step budget
  lines.push(`## Step Budget`);
  lines.push(`You have a maximum of ${config.maxSteps} steps.`);
  lines.push("");

  // Time budget
  lines.push(`## Time Budget`);
  lines.push(`You have a maximum of ${config.maxTime}ms total time.`);
  lines.push("");

  // Response format
  lines.push("## Response Format");
  lines.push("Return a JSON object with the following structure:");
  lines.push('{ "action": "<action_type>", "params": { ... }, "notes": "<reasoning>" }');
  lines.push("");

  // Strategy tips
  lines.push("## Exploration Strategy");
  lines.push("- Start by navigating to the main page");
  lines.push("- Identify key interactive elements (buttons, links, forms)");
  lines.push("- Fill in form fields with realistic test data");
  lines.push("- Wait for page transitions after actions");
  lines.push("- Add narration at key moments to explain what's happening");
  lines.push("- End with the `done` action when the demo is complete");
  lines.push("- Focus on the user-facing features that showcase the product");

  return lines.join("\n");
}

// ─── Page State Serializer ───────────────────────────────────────────────────

/**
 * Serializes the current browser page state into a structured format
 * suitable for LLM context.
 */
async function serializePageState(
  browser: BrowserSession,
  config: ExplorerConfig
): Promise<PageState> {
  const browserState = await browser.getState();

  // Extract accessibility tree and selectors from the page
  const axTree: AccessibilityNode[] = [];
  const selectors: string[] = [];
  const formFields: FormField[] = [];

  try {
    // Use Playwright's accessibility snapshot
    const page = browser.page;
    if (page) {
      const snapshot = await (page as any).accessibility.snapshot();
      if (snapshot) {
        extractAxTree(snapshot as Record<string, unknown>, axTree, selectors, formFields, 0);
      }
    }
  } catch {
    // Fallback: build a minimal page state without AX tree
  }

  return {
    url: browserState.url,
    title: browserState.title,
    viewport: browserState.viewport,
    axTree,
    selectors,
    formFields,
  };
}

/**
 * Recursively extracts accessibility tree nodes, selectors, and form fields.
 */
function extractAxTree(
  node: Record<string, unknown>,
  axTree: AccessibilityNode[],
  selectors: string[],
  formFields: FormField[],
  depth: number
): void {
  const role = (node.role as string) || "";
  const name = (node.name as string) || "";
  const tag = (node.nodeLabel as string) || "";
  const value = (node.valueObject as Record<string, unknown>)?.value as string | undefined;
  const children = node.children as Record<string, unknown>[] | undefined;

  const axNode: AccessibilityNode = {
    role,
    name,
    tag,
    value,
    interactive: isInteractiveRole(role),
    depth,
  };

  // Try to extract a selector from the node
  const childSelector = extractSelector(node);
  if (childSelector) {
    axNode.selector = childSelector;
    if (!selectors.includes(childSelector)) {
      selectors.push(childSelector);
    }
  }

  // Extract form fields
  if (isFormFieldRole(role) || isFormFieldTag(tag)) {
    formFields.push({
      selector: childSelector || `[role="${role}"]`,
      name: name || "",
      type: role,
      value: value || "",
      placeholder: (node.placeholder as string) || "",
      required: isRequiredRole(role),
    });
  }

  axTree.push(axNode);

  if (children) {
    for (const child of children) {
      extractAxTree(child, axTree, selectors, formFields, depth + 1);
    }
  }
}

/**
 * Checks if a role indicates an interactive element.
 */
function isInteractiveRole(role: string): boolean {
  const interactiveRoles = new Set([
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "menuitem", "option", "tab", "switch", "slider", "spinbutton",
    "searchbox", "listbox", "treeitem", "gridcell", "cell", "row",
    "columnheader", "rowheader", "menu", "list", "tree", "tablist",
    "toolbar", "navigation", "main", "contentinfo", "banner",
  ]);
  return interactiveRoles.has(role);
}

/**
 * Checks if a role is a form field.
 */
function isFormFieldRole(role: string): boolean {
  const formRoles = new Set([
    "textbox", "combobox", "listbox", "spinbutton", "slider",
    "checkbox", "radio", "switch",
  ]);
  return formRoles.has(role);
}

/**
 * Checks if a tag indicates a form field.
 */
function isFormFieldTag(tag: string): boolean {
  const formTags = new Set(["input", "select", "textarea"]);
  return formTags.has(tag.toLowerCase());
}

/**
 * Checks if a role indicates a required field.
 */
function isRequiredRole(role: string): boolean {
  const requiredRoles = new Set(["textbox", "checkbox", "radio", "combobox", "listbox", "spinbutton"]);
  return requiredRoles.has(role);
}

/**
 * Extracts a CSS selector from an accessibility node.
 */
function extractSelector(node: Record<string, unknown>): string | null {
  // Try to get the element's CSS selector from the snapshot
  const domRef = node.domElement as string;
  if (domRef) {
    // domElement contains the serialized element, extract tag/role
    const tagMatch = domRef.match(/<(\w+)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const role = (node.role as string) || "";
      const name = (node.name as string) || "";

      if (role && name) {
        // Use role+name selector
        const escapedName = name.replace(/"/g, '\\"');
        return `[role="${role}"][name="${escapedName}"]`;
      }
      if (role) {
        return `[role="${role}"]`;
      }
      return tag;
    }
  }

  // Fallback: try to get a text-based selector
  const text = (node.name as string) || "";
  if (text) {
    const tag = (node.nodeLabel as string) || "span";
    const escapedText = text.replace(/"/g, '\\"');
    return `${tag}:has-text("${escapedText}")`;
  }

  return null;
}

// ─── LLM Request Builder ─────────────────────────────────────────────────────

/**
 * Builds the conversation messages for an LLM request.
 */
function buildLlmMessages(
  systemPrompt: string,
  pageState: PageState,
  history: Array<{ role: "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const userMessages: string[] = [];

  userMessages.push("## Current Page State");
  userMessages.push(`URL: ${pageState.url}`);
  userMessages.push(`Title: ${pageState.title}`);
  userMessages.push(`Viewport: ${pageState.viewport.width}x${pageState.viewport.height}`);
  userMessages.push("");

  if (pageState.axTree.length > 0) {
    userMessages.push("## Accessibility Tree");
    for (const node of pageState.axTree) {
      const indent = "  ".repeat(node.depth);
      const selector = node.selector ? ` [${node.selector}]` : "";
      const value = node.value ? ` (value: "${node.value}")` : "";
      userMessages.push(`${indent}- ${node.tag || "?"} [${node.role}]${selector}: "${node.name}"${value}`);
    }
    userMessages.push("");
  }

  if (pageState.formFields.length > 0) {
    userMessages.push("## Form Fields");
    for (const field of pageState.formFields) {
      userMessages.push(
        `- ${field.selector}: type="${field.type}", name="${field.name}", value="${field.value}"${field.required ? " (required)" : ""}`
      );
    }
    userMessages.push("");
  }

  userMessages.push("## Available Selectors");
  for (const sel of pageState.selectors.slice(0, 20)) {
    userMessages.push(`- ${sel}`);
  }
  userMessages.push("");

  if (history.length > 0) {
    userMessages.push("## Previous Actions");
    for (const h of history) {
      userMessages.push(`- ${h.content}`);
    }
    userMessages.push("");
  }

  userMessages.push("What action should I take next?");

  return [
    { role: "system" as const, content: systemPrompt },
    ...history.map((h) => ({ role: "assistant" as const, content: h.content })),
    { role: "user" as const, content: userMessages.join("\n") },
  ];
}

// ─── Action Executor ─────────────────────────────────────────────────────────

/**
 * Executes an action on the browser based on the LLM response.
 * Returns a result string describing what happened.
 */
async function executeAction(
  browser: BrowserSession,
  action: LlmActionResponse
): Promise<{ result: string; error?: string }> {
  const params = action.params as Record<string, unknown> | undefined;

  switch (action.action) {
    case "goto": {
      const url = params?.url as string;
      if (!url) {
        return { result: "skipped", error: "goto requires url parameter" };
      }
      await browser.goto(url);
      return { result: `navigated to ${url}` };
    }

    case "click": {
      const selector = params?.selector as string;
      if (!selector) {
        return { result: "skipped", error: "click requires selector parameter" };
      }
      await browser.click(selector);
      return { result: `clicked ${selector}` };
    }

    case "hover": {
      const selector = params?.selector as string;
      if (!selector) {
        return { result: "skipped", error: "hover requires selector parameter" };
      }
      await browser.hover(selector);
      return { result: `hovered ${selector}` };
    }

    case "fill": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) {
        return { result: "skipped", error: "fill requires selector and value parameters" };
      }
      await browser.fill(selector, value);
      return { result: `filled ${selector} with "${value}"` };
    }

    case "select": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) {
        return { result: "skipped", error: "select requires selector and value parameters" };
      }
      await browser.select(selector, value);
      return { result: `selected "${value}" in ${selector}` };
    }

    case "press": {
      const key = params?.key as string;
      if (!key) {
        return { result: "skipped", error: "press requires key parameter" };
      }
      await browser.press(key);
      return { result: `pressed ${key}` };
    }

    case "scroll": {
      const amount = params?.amount as number;
      if (amount === undefined) {
        return { result: "skipped", error: "scroll requires amount parameter" };
      }
      await browser.scroll({ deltaY: amount });
      return { result: `scrolled by ${amount}` };
    }

    case "wait_for": {
      const text = params?.text as string;
      const selector = params?.selector as string;
      if (text) {
        await browser.wait_for({ text });
        return { result: `waited for text "${text}"` };
      } else if (selector) {
        await browser.wait_for({ selector });
        return { result: `waited for selector ${selector}` };
      }
      return { result: "skipped", error: "wait_for requires text or selector parameter" };
    }

    case "narrate": {
      const narration = action.narration || (params?.narration as string) || "";
      if (!narration) {
        return { result: "skipped", error: "narrate requires narration text" };
      }
      return { result: `narration: "${narration}"` };
    }

    case "screenshot": {
      const buf = await browser.screenshot();
      return { result: `screenshot taken (${buf.length} bytes)` };
    }

    case "mark_flow_start": {
      const name = params?.name as string;
      if (!name) {
        return { result: "skipped", error: "mark_flow_start requires name parameter" };
      }
      return { result: `flow started: ${name}` };
    }

    case "mark_flow_end": {
      const name = params?.name as string;
      if (!name) {
        return { result: "skipped", error: "mark_flow_end requires name parameter" };
      }
      return { result: `flow ended: ${name}` };
    }

    case "done": {
      return { result: "exploration done" };
    }

    case "pause": {
      const duration = params?.duration as number;
      if (duration === undefined) {
        return { result: "skipped", error: "pause requires duration parameter" };
      }
      await new Promise((resolve) => setTimeout(resolve, duration));
      return { result: `paused for ${duration}ms` };
    }

    default: {
      return { result: "skipped", error: `unknown action type: ${action.action}` };
    }
  }
}

// ─── Guardrails Checker ──────────────────────────────────────────────────────

/**
 * Normalizes a string for comparison: lowercases, replaces hyphens/underscores
 * with spaces, and trims.
 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, " ").trim();
}

/**
 * Checks if an action should be blocked by guardrails.
 * Returns null if allowed, or a reason string if blocked.
 */
function checkGuardrails(
  action: LlmActionResponse,
  guardrails: GuardrailsConfig | undefined,
  currentPageUrl: string
): string | null {
  if (!guardrails) {
    return null;
  }

  const params = action.params as Record<string, unknown> | undefined;

  // Check destructive button patterns
  if (guardrails.destructiveButtonPatterns) {
    const selector = params?.selector as string;
    if (selector) {
      const normalizedSelector = normalizeForMatch(selector);
      for (const pattern of guardrails.destructiveButtonPatterns) {
        const normalizedPattern = normalizeForMatch(pattern);
        if (normalizedSelector.includes(normalizedPattern)) {
          return `blocked by guardrail: selector "${selector}" matches destructive pattern "${pattern}"`;
        }
      }
    }

    const notes = action.notes?.toLowerCase() || "";
    for (const pattern of guardrails.destructiveButtonPatterns) {
      if (notes.includes(pattern.toLowerCase())) {
        return `blocked by guardrail: action notes mention destructive pattern "${pattern}"`;
      }
    }
  }

  // Check destructive URL patterns
  if (guardrails.destructiveUrlPatterns) {
    const url = params?.url as string;
    if (url) {
      const urlLower = url.toLowerCase();
      for (const pattern of guardrails.destructiveUrlPatterns) {
        if (urlLower.includes(pattern.toLowerCase())) {
          return `blocked by guardrail: URL "${url}" matches destructive pattern "${pattern}"`;
        }
      }
    }
  }

  // Check origin allowlist
  if (guardrails.allowedOrigins && guardrails.allowedOrigins.length > 0) {
    const url = params?.url as string;
    if (url) {
      const parsedUrl = new URL(url);
      const allowed = guardrails.allowedOrigins.some((origin) => {
        try {
          const allowedUrl = new URL(origin);
          return parsedUrl.hostname === allowedUrl.hostname;
        } catch {
          return url.startsWith(origin);
        }
      });
      if (!allowed) {
        return `blocked by guardrail: URL "${url}" is outside allowed origins`;
      }
    }
  }

  return null;
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

/**
 * Converts an LLM action response into a DemoStep.
 */
function buildDemoStep(action: LlmActionResponse): DemoStep | null {
  const params = action.params as Record<string, unknown> | undefined;

  switch (action.action) {
    case "goto": {
      const url = params?.url as string;
      if (!url) return null;
      return { goto: url };
    }

    case "click": {
      const selector = params?.selector as string;
      if (!selector) return null;
      return { click: selector };
    }

    case "hover": {
      const selector = params?.selector as string;
      if (!selector) return null;
      return { hover: selector };
    }

    case "fill": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) return null;
      return { fill: { target: selector, value } };
    }

    case "select": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) return null;
      return { select: { target: selector, value } };
    }

    case "press": {
      const key = params?.key as string;
      if (!key) return null;
      return { press: { key } };
    }

    case "scroll": {
      const amount = params?.amount as number;
      if (amount === undefined) return null;
      return { scroll: { amount } };
    }

    case "wait_for": {
      const text = params?.text as string;
      const selector = params?.selector as string;
      if (text) {
        return { wait_for: { text } };
      } else if (selector) {
        return { wait_for: { selector } };
      }
      return null;
    }

    case "narrate": {
      const narration = action.narration || (params?.narration as string) || "";
      if (!narration) return null;
      return { narrate: narration };
    }

    case "screenshot": {
      return { screenshot: {} };
    }

    case "mark_flow_start": {
      const name = params?.name as string;
      if (!name) return null;
      return { mark_flow_start: { name } };
    }

    case "mark_flow_end": {
      const name = params?.name as string;
      if (!name) return null;
      return { mark_flow_end: { name } };
    }

    case "done": {
      return { done: true };
    }

    case "pause": {
      const duration = params?.duration as number;
      if (duration === undefined) return null;
      return { pause: duration };
    }

    default:
      return null;
  }
}

// ─── Script Assembly ─────────────────────────────────────────────────────────

/**
 * Assembles a Demo Script from the exploration transcript.
 * Validates the result against the T2 schema.
 */
function assembleScript(
  config: ExplorerConfig,
  turns: ExplorationTurn[]
): { script: DemoScript; valid: boolean; errors?: string[] } {
  const steps: DemoStep[] = [];

  for (const turn of turns) {
    if (turn.blocked) {
      continue;
    }

    const action = turn.selectedAction;
    if (!action) {
      continue;
    }

    const step = buildDemoStep(action);
    if (step) {
      steps.push(step);
    }
  }

  // Ensure the script ends with a done step
  const lastStep = steps[steps.length - 1];
  if (!lastStep || !("done" in lastStep)) {
    steps.push({ done: true });
  }

  const script: DemoScript = {
    demo: config.goal,
    title: config.scriptTemplate.title,
    viewport: {
      width: config.viewport.width,
      height: config.viewport.height,
      scale: 1,
    },
    narration_mode: config.scriptTemplate.narration_mode,
    steps,
  };

  // Validate against T2 schema
  const validation = validateDemoScript(script);
  if (!validation.success) {
    const failure = validation as unknown as { success: false; error: { errors: Array<{ path: string[]; message: string }> } };
    return {
      script,
      valid: false,
      errors: failure.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`
      ),
    };
  }

  return { script, valid: true };
}

// ─── ExplorerAgent ───────────────────────────────────────────────────────────

/**
 * Main exploration agent class.
 *
 * Drives the browser, calls the LLM for action selection, executes actions,
 * and builds a demo script from the exploration transcript.
 */
export class ExplorerAgent {
  private config: ExplorerConfig;
  private transcript: ExplorationTranscript;
  private llmHistory: Array<{ role: "assistant"; content: string }> = [];
  private actionCount = 0;
  private startTime = 0;

  constructor(config: ExplorerConfig) {
    this.config = config;
    this.transcript = {
      url: config.url,
      goal: config.goal,
      turns: [],
      totalTurns: 0,
      blockedTurns: 0,
      elapsed: 0,
      completed: false,
      stopReason: undefined,
    };
  }

  /**
   * Run the exploration loop.
   * Each turn: serialize page state -> call LLM -> parse response ->
   * execute action -> record step -> repeat until done or budget exhausted.
   */
  async run(): Promise<ExplorationResult> {
    this.startTime = Date.now();
    const browser = this.config.browser;

    // Launch browser
    await browser.launch();

    try {
      const systemPrompt = buildSystemPrompt(this.config);
      const actionSchema = buildActionSchema();

      // Navigate to starting URL
      await browser.goto(this.config.url);

      // Main exploration loop
      while (this.actionCount < this.config.maxSteps) {
        // Check time budget
        const elapsed = Date.now() - this.startTime;
        if (elapsed >= this.config.maxTime) {
          this.report({ type: "budget_exceeded", message: "Time budget exceeded" });
          this.transcript.stopReason = "max_time";
          break;
        }

        // Serialize page state
        const pageState = await serializePageState(browser, this.config);

        // Build LLM messages
        const messages = buildLlmMessages(systemPrompt, pageState, this.llmHistory);

        // Record turn start
        const turnNumber = this.transcript.totalTurns + 1;
        const turnStart = new Date().toISOString();
        this.report({ type: "turn_start", turn: turnNumber, steps: this.actionCount });

        // Call LLM
        let llmResponse: LlmActionResponse;
        let turnError: string | undefined;

        try {
          llmResponse = await this.config.llmClient.sendAction(
            systemPrompt,
            messages,
            actionSchema
          );
        } catch (error) {
          turnError = error instanceof Error ? error.message : "Unknown LLM error";
          this.report({
            type: "turn_end",
            turn: turnNumber,
            steps: this.actionCount,
            message: `LLM error: ${turnError}`,
          });

          // Record the failed turn
          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            blocked: true,
            blockReason: `LLM error: ${turnError}`,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;

          // Stop on LLM error
          this.transcript.stopReason = "error";
          break;
        }

        // Validate action type
        if (!VALID_ACTIONS.has(llmResponse.action)) {
          const blockReason = `invalid action type: "${llmResponse.action}" is not in the allowed action space`;
          this.report({
            type: "action_blocked",
            turn: turnNumber,
            action: llmResponse.action,
            blocked: true,
            blockReason,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            blocked: true,
            blockReason,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;
          continue;
        }

        // Check guardrails
        const currentPageUrl = pageState.url;
        const guardrailBlockReason = checkGuardrails(llmResponse, this.config.guardrails, currentPageUrl);

        if (guardrailBlockReason) {
          this.report({
            type: "action_blocked",
            turn: turnNumber,
            action: llmResponse.action,
            actionParams: llmResponse.params,
            blocked: true,
            blockReason: guardrailBlockReason,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            blocked: true,
            blockReason: guardrailBlockReason,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;
          continue;
        }

        // Execute action
        const { result, error } = await executeAction(browser, llmResponse);

        if (error) {
          this.report({
            type: "turn_end",
            turn: turnNumber,
            steps: this.actionCount,
            message: `Action error: ${error}`,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            endTime: new Date().toISOString(),
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            executedAction: llmResponse,
            blocked: false,
            actionResult: `error: ${error}`,
            error,
          });
          this.transcript.totalTurns++;
          continue;
        }

        // Record successful action
        this.actionCount++;
        this.report({
          type: "action_executed",
          turn: turnNumber,
          action: llmResponse.action,
          actionParams: llmResponse.params,
          message: result,
        });

        this.llmHistory.push({
          role: "assistant",
          content: `${llmResponse.action}: ${result}${llmResponse.notes ? " (" + llmResponse.notes + ")" : ""}`,
        });

        this.transcript.turns.push({
          turn: turnNumber,
          startTime: turnStart,
          endTime: new Date().toISOString(),
          pageState,
          systemPrompt,
          llmRequest: messages,
          llmResponse,
          selectedAction: llmResponse,
          executedAction: llmResponse,
          blocked: false,
          actionResult: result,
        });

        this.transcript.totalTurns++;

        this.report({
          type: "turn_end",
          turn: turnNumber,
          steps: this.actionCount,
          message: result,
        });

        // Check if done
        if (llmResponse.action === "done") {
          this.transcript.stopReason = "done";
          this.transcript.completed = true;
          break;
        }
      }

      // Step budget check
      if (!this.transcript.stopReason) {
        this.report({
          type: "budget_exceeded",
          message: `Step budget exceeded: ${this.actionCount}/${this.config.maxSteps}`,
        });
        this.transcript.stopReason = "max_steps";
      }

      // Assemble script
      const assembly = assembleScript(this.config, this.transcript.turns);
      this.transcript.assembly = {
        script: assembly.script,
        valid: assembly.valid,
        errors: assembly.errors,
      };

      this.report({
        type: "script_assembled",
        steps: assembly.script.steps.length,
        message: `Assembled ${assembly.script.steps.length} steps${assembly.errors ? ` (${assembly.errors.length} validation errors)` : ""}`,
      });

      // Human confirmation step
      let confirmed = false;
      if (this.config.requireConfirmation && this.config.confirmDiscovery) {
        const proposedFlows = this.proposeFlows();
        this.report({
          type: "human_confirm_requested",
          flows: proposedFlows,
          message: `Proposed ${proposedFlows.length} flow(s) for confirmation`,
        });

        const selectedFlows = await this.config.confirmDiscovery(proposedFlows);
        confirmed = selectedFlows.length > 0;

        this.report({
          type: "human_confirm_received",
          confirmed,
          message: confirmed ? "User confirmed the proposed flows" : "User declined all flows",
        });

        if (!confirmed) {
          this.transcript.stopReason = "declined";
        }
      }

      this.transcript.elapsed = Date.now() - this.startTime;

      this.report({
        type: "exploration_complete",
        steps: this.actionCount,
        message: `Exploration complete: ${this.actionCount} actions, ${this.transcript.blockedTurns} blocked`,
      });

      return {
        success: this.transcript.stopReason === "done" && !assembly.errors,
        script: assembly.script,
        transcript: this.transcript,
        confirmed,
        stopReason: this.transcript.stopReason || "unknown",
      };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Propose flows from the exploration transcript for human confirmation.
   */
  private proposeFlows(): string[] {
    const flows: string[] = [];
    let currentFlow: string[] = [];

    for (const turn of this.transcript.turns) {
      if (turn.blocked) continue;

      const action = turn.selectedAction;
      if (!action) continue;

      if (action.action === "mark_flow_start") {
        if (currentFlow.length > 0) {
          flows.push(currentFlow.join(" -> "));
        }
        currentFlow = [action.params?.name as string || "untitled"];
      } else if (action.action === "mark_flow_end") {
        currentFlow.push(action.params?.name as string || "end");
        flows.push(currentFlow.join(" -> "));
        currentFlow = [];
      } else if (action.action === "goto") {
        const url = action.params?.url as string;
        if (url) {
          const label = new URL(url).hostname.replace("www.", "");
          currentFlow.push(label);
        }
      } else if (action.action === "done") {
        if (currentFlow.length > 0) {
          flows.push(currentFlow.join(" -> "));
        }
      } else {
        const actionLabel = `${action.action}(${Object.keys(action.params || {}).join(", ")})`;
        if (currentFlow.length === 0) {
          currentFlow.push(actionLabel);
        } else {
          currentFlow.push(actionLabel);
        }
      }
    }

    if (currentFlow.length > 0 && flows.length === 0) {
      flows.push(currentFlow.join(" -> "));
    }

    if (flows.length === 0) {
      flows.push("Main exploration flow");
    }

    return flows;
  }

  /**
   * Report a progress event to the progress reporter.
   */
  private report(event: ProgressEvent): void {
    event.elapsed = event.elapsed ?? (Date.now() - this.startTime);
    event.steps = event.steps ?? this.actionCount;
    event.maxSteps = event.maxSteps ?? this.config.maxSteps;
    event.maxTime = event.maxTime ?? this.config.maxTime;
    this.config.reporter.report(event);
  }
}
