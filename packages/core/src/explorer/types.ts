/**
 * DemoForge explorer — type definitions for the exploration agent.
 *
 * Types for the agent loop, page state, LLM interaction, transcript,
 * and progress reporting.
 */

import type { DemoScript } from "../types/index.js";

// ─── Action Types ────────────────────────────────────────────────────────────

/**
 * Action types the LLM can return during exploration.
 * Mirrors DemoStep action types but as simple string identifiers.
 */
export type ExplorerActionType =
  | "goto"
  | "click"
  | "hover"
  | "fill"
  | "select"
  | "press"
  | "scroll"
  | "wait_for"
  | "narrate"
  | "screenshot"
  | "mark_flow_start"
  | "mark_flow_end"
  | "done"
  | "pause";

/**
 * LLM response format for action selection.
 * The LLM returns one action per turn via JSON schema constraint.
 */
export interface LlmActionResponse {
  /** The action type to execute */
  action: ExplorerActionType;
  /** Action parameters (structure depends on action type) */
  params?: Record<string, unknown>;
  /** Narration text for narrate steps */
  narration?: string;
  /** Notes explaining the LLM's reasoning */
  notes?: string;
}

// ─── Page State ──────────────────────────────────────────────────────────────

/** Serialized page state for LLM context. */
export interface PageState {
  /** Current URL */
  url: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Accessibility tree snapshot (compacted) */
  axTree: AccessibilityNode[];
  /** Available selectors for targeting */
  selectors: string[];
  /** Current form field values */
  formFields: FormField[];
  /** Visible modal/dialog surfaces that may require completion before done */
  openDialogs?: OpenDialog[];
  /** Visible page text (truncated) so the LLM can read on-screen data */
  visibleText?: string;
}

/** A single accessibility tree node. */
export interface AccessibilityNode {
  /** Role (button, link, textbox, heading, etc.) */
  role: string;
  /** Accessible name */
  name: string;
  /** HTML tag name */
  tag: string;
  /** Current value (for form fields) */
  value?: string;
  /** Whether the element is interactive */
  interactive: boolean;
  /** CSS selector for the element */
  selector?: string;
  /** Child nodes */
  children?: AccessibilityNode[];
  /** Depth in the tree */
  depth: number;
}

/** A form field discovered on the page. */
export interface FormField {
  /** Field selector */
  selector: string;
  /** Field name/id */
  name: string;
  /** Field type (text, email, password, select, checkbox, radio) */
  type: string;
  /** Current value */
  value: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required: boolean;
}

/** A visible modal/dialog captured from the current page. */
export interface OpenDialog {
  /** Dialog title or heading, if available */
  title?: string;
  /** Visible dialog text, truncated */
  text: string;
  /** Visible dialog action labels */
  actions: string[];
  /** Selectors for visible dialog actions */
  selectors: string[];
}

// ─── LLM Client Interface ────────────────────────────────────────────────────

/**
 * LLM client interface for the explorer agent.
 *
 * T7_llm will implement this interface. A MockLlmClient is provided for testing.
 */
export interface LlmClient {
  /**
   * Send a request to the LLM with system prompt, messages, and JSON schema constraint.
   * Returns the parsed LLM action response.
   */
  sendAction(
    systemPrompt: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    actionSchema: Record<string, unknown>
  ): Promise<LlmActionResponse>;
}

// ─── Progress Reporter ───────────────────────────────────────────────────────

/** Progress update types for the explorer agent. */
export type ProgressEventType =
  | "turn_start"
  | "turn_end"
  | "action_executed"
  | "action_blocked"
  | "budget_warning"
  | "budget_exceeded"
  | "discovery_complete"
  | "human_confirm_requested"
  | "human_confirm_received"
  | "script_assembled"
  | "exploration_complete";

/** A single progress event. */
export interface ProgressEvent {
  /** Event type */
  type: ProgressEventType;
  /** Current turn number (1-indexed) */
  turn?: number;
  /** Current step count */
  steps?: number;
  /** Maximum steps allowed */
  maxSteps?: number;
  /** Elapsed time in milliseconds */
  elapsed?: number;
  /** Maximum time in milliseconds */
  maxTime?: number;
  /** Action type that was executed or blocked */
  action?: string;
  /** Action parameters */
  actionParams?: Record<string, unknown>;
  /** Result message */
  message?: string;
  /** Whether the action was blocked by guardrails */
  blocked?: boolean;
  /** Reason the action was blocked */
  blockReason?: string;
  /** Discovery flow proposals */
  flows?: string[];
  /** Human confirmation result */
  confirmed?: boolean;
  /** Validation errors if script assembly failed */
  validationErrors?: string[];
}

/**
 * Progress reporter interface for explorer agent callbacks.
 */
export interface ProgressReporter {
  /** Report a progress event */
  report(event: ProgressEvent): void;
}

// ─── Guardrails ──────────────────────────────────────────────────────────────

/**
 * Guardrails configuration for the explorer agent.
 * Defines what actions are allowed or blocked during exploration.
 */
export interface GuardrailsConfig {
  /** Allowed origins (URL patterns). Empty = allow all. */
  allowedOrigins?: string[];
  /** Destructive button text patterns to block (case-insensitive) */
  destructiveButtonPatterns?: string[];
  /** Destructive URL patterns to block (case-insensitive) */
  destructiveUrlPatterns?: string[];
}

// ─── Explorer Config ─────────────────────────────────────────────────────────

/** Configuration for the exploration agent. */
export interface ExplorerConfig {
  /** URL to start exploration from */
  url: string;
  /** Exploration goal (what the demo should demonstrate) */
  goal: string;
  /** Maximum number of exploration steps */
  maxSteps: number;
  /** Maximum exploration time in milliseconds */
  maxTime: number;
  /** Browser viewport dimensions */
  viewport: { width: number; height: number; scale?: number };
  /** Guardrails configuration */
  guardrails?: GuardrailsConfig;
  /** Progress reporter callback */
  reporter: ProgressReporter;
  /** LLM client for action selection */
  llmClient: LlmClient;
  /** Demo script template (title, viewport, narration_mode) */
  scriptTemplate: Pick<DemoScript, "title" | "narration_mode">;
  /** Whether to wait for human confirmation after discovery */
  requireConfirmation: boolean;
  /** Browser session for executing actions */
  browser: import("@demoforge/browser").BrowserSession;
  /** Human confirmation callback — returns selected flow names (empty = decline) */
  confirmDiscovery?: (proposedFlows: string[]) => Promise<string[]>;
}

// ─── Transcript ──────────────────────────────────────────────────────────────

/** A single turn in the exploration transcript. */
export interface ExplorationTurn {
  /** Turn number (1-indexed) */
  turn: number;
  /** Timestamp when the turn started (ISO string) */
  startTime: string;
  /** Timestamp when the turn ended (ISO string) */
  endTime?: string;
  /** Page state sent to the LLM */
  pageState: PageState;
  /** System prompt used */
  systemPrompt: string;
  /** LLM request messages */
  llmRequest: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** LLM response */
  llmResponse?: LlmActionResponse;
  /** Action that was selected */
  selectedAction?: LlmActionResponse;
  /** Action that was actually executed (may differ if blocked) */
  executedAction?: LlmActionResponse;
  /** Whether the action was blocked by guardrails */
  blocked: boolean;
  /** Reason the action was blocked */
  blockReason?: string;
  /** Action execution result */
  actionResult?: string;
  /** Error if the turn failed */
  error?: string;
}

/** Complete exploration transcript. */
export interface ExplorationTranscript {
  /** Exploration URL */
  url: string;
  /** Exploration goal */
  goal: string;
  /** All turns that occurred */
  turns: ExplorationTurn[];
  /** Total turns executed */
  totalTurns: number;
  /** Total turns blocked by guardrails */
  blockedTurns: number;
  /** Total elapsed time in milliseconds */
  elapsed: number;
  /** Whether exploration completed normally or was stopped by budget */
  completed: boolean;
  /** Reason exploration stopped */
  stopReason?: string;
  /** Assembly result */
  assembly?: ScriptAssemblyResult;
}

/** Result of script assembly from transcript. */
export interface ScriptAssemblyResult {
  /** The assembled demo script */
  script: DemoScript;
  /** Whether the script passed schema validation */
  valid: boolean;
  /** Validation errors if invalid */
  errors?: string[];
}

// ─── Exploration Result ──────────────────────────────────────────────────────

/** Final result of an exploration session. */
export interface ExplorationResult {
  /** Whether exploration completed successfully */
  success: boolean;
  /** The assembled demo script */
  script: DemoScript;
  /** Full exploration transcript */
  transcript: ExplorationTranscript;
  /** Whether the result was confirmed by the user */
  confirmed: boolean;
  /** Stop reason (e.g., "done", "max_steps", "max_time", "error") */
  stopReason: string;
}
