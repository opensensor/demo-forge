/**
 * DemoForge explorer — transcript logging, script assembly,
 * human confirmation UI, and file persistence.
 *
 * Provides:
 * - Transcript: turn-by-turn logging with page state, LLM I/O, actions, results
 * - ScriptAssembly: collects turns into a valid Demo Script structure
 * - HumanConfirmUI: presents proposed flows, waits for accept/reject/modify
 * - File I/O: save/load transcripts to .demoforge/transcript/ as JSON
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateDemoScript } from "../schema/demoScriptSchema.js";
import { ExplorerError } from "../errors/index.js";
import type { DemoScript, DemoStep } from "../types/index.js";
import type {
  ExplorationTurn,
  ExplorationTranscript,
  ScriptAssemblyResult,
  PageState,
  LlmActionResponse,
} from "./types.js";

// ─── Human Confirmation Types ────────────────────────────────────────────────

/** Human confirmation decision */
export type ConfirmDecision = "accept" | "reject" | "modify";

/** Result of a human confirmation interaction */
export interface HumanConfirmationResult {
  decision: ConfirmDecision;
  selectedFlows: string[];
  confirmed: boolean;
}

/** Callback type for human confirmation */
export type ConfirmCallback = (
  proposedFlows: string[]
) => Promise<HumanConfirmationResult>;

// ─── Utility: Truncate Content ───────────────────────────────────────────────

const DEFAULT_MAX_LENGTH = 500;

/**
 * Truncates a string to a maximum length, appending "..." if truncated.
 * Non-string values are converted to string first.
 */
export function truncateContent(
  content: unknown,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  if (content === null) return "null";
  if (content === undefined) return "undefined";
  const str = String(content);
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength) + "...";
}

// ─── Transcript Class ────────────────────────────────────────────────────────

/**
 * Options for creating a Transcript.
 */
export interface TranscriptOptions {
  /** The URL being explored */
  url: string;
  /** The exploration goal */
  goal: string;
}

/**
 * Turn payload for adding a turn to the transcript.
 * Turn number is auto-incremented if not provided.
 */
export interface TurnPayload {
  /** Turn number (1-indexed, auto-incremented if omitted) */
  turn?: number;
  /** Timestamp when the turn started (ISO string) */
  startTime?: string;
  /** Page state snapshot sent to the LLM */
  pageState: PageState;
  /** System prompt used for this turn */
  systemPrompt: string;
  /** LLM request messages (truncated on serialization) */
  llmRequest: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** LLM response (may be undefined for blocked/error turns) */
  llmResponse?: LlmActionResponse;
  /** Selected action (may differ from llmResponse if modified) */
  selectedAction?: LlmActionResponse;
  /** Action that was actually executed */
  executedAction?: LlmActionResponse;
  /** Whether the action was blocked by guardrails */
  blocked: boolean;
  /** Reason the action was blocked */
  blockReason?: string;
  /** Action execution result string */
  actionResult?: string;
  /** Error message if the turn encountered an error */
  error?: string;
}

/**
 * Exploration transcript — turn-by-turn log of the entire exploration session.
 *
 * Each turn captures:
 * - Page state snapshot (URL, title, AX tree, selectors, form fields)
 * - LLM request (system prompt + conversation messages, truncated)
 * - LLM response (action selection with params)
 * - Action executed (may differ from selected if guardrails modified it)
 * - Action result (success/error message)
 *
 * Transcript is saved to `.demoforge/transcript/` as JSON with timestamps
 * for debugging and replay purposes.
 */
export class Transcript {
  private options: TranscriptOptions;
  private turns: ExplorationTurn[] = [];
  private totalTurns = 0;
  private blockedTurns = 0;
  private elapsed = 0;
  private completed = false;
  private stopReason?: string;

  constructor(options: TranscriptOptions) {
    this.options = options;
  }

  /**
   * Add a turn to the transcript.
   * Auto-increments turn number if not provided.
   */
  addTurn(payload: TurnPayload): void {
    const turnNumber = payload.turn ?? (this.totalTurns + 1);
    const startTime = payload.startTime ?? new Date().toISOString();
    const endTime = new Date().toISOString();

    const turn: ExplorationTurn = {
      turn: turnNumber,
      startTime,
      endTime,
      pageState: payload.pageState,
      systemPrompt: payload.systemPrompt,
      llmRequest: payload.llmRequest,
      llmResponse: payload.llmResponse,
      selectedAction: payload.selectedAction,
      executedAction: payload.executedAction,
      blocked: payload.blocked,
      blockReason: payload.blockReason,
      actionResult: payload.actionResult,
      error: payload.error,
    };

    this.turns.push(turn);
    this.totalTurns++;

    if (payload.blocked) {
      this.blockedTurns++;
    }
  }

  /**
   * Get all turns in the transcript.
   */
  getTurns(): ExplorationTurn[] {
    return [...this.turns];
  }

  /**
   * Get the total number of turns.
   */
  getTotalTurns(): number {
    return this.totalTurns;
  }

  /**
   * Get the number of blocked turns.
   */
  getBlockedTurns(): number {
    return this.blockedTurns;
  }

  /**
   * Set the total elapsed time in milliseconds.
   */
  setElapsed(ms: number): void {
    this.elapsed = ms;
  }

  /**
   * Set whether exploration completed normally.
   */
  setCompleted(value: boolean): void {
    this.completed = value;
  }

  /**
   * Set the stop reason.
   */
  setStopReason(reason: string): void {
    this.stopReason = reason;
  }

  /**
   * Serialize the transcript to JSON string.
   * LLM request content is truncated to keep file size manageable.
   */
  toJson(): string {
    const truncatedTurns = this.turns.map((turn) => ({
      turn: turn.turn,
      startTime: turn.startTime,
      endTime: turn.endTime,
      pageState: turn.pageState,
      systemPrompt: truncateContent(turn.systemPrompt, 2000),
      llmRequest: turn.llmRequest.map((msg) => ({
        ...msg,
        content: truncateContent(msg.content, 3000),
      })),
      llmResponse: turn.llmResponse,
      selectedAction: turn.selectedAction,
      executedAction: turn.executedAction,
      blocked: turn.blocked,
      blockReason: turn.blockReason,
      actionResult: turn.actionResult,
      error: turn.error,
    }));

    const json: ExplorationTranscript = {
      url: this.options.url,
      goal: this.options.goal,
      turns: truncatedTurns,
      totalTurns: this.totalTurns,
      blockedTurns: this.blockedTurns,
      elapsed: this.elapsed,
      completed: this.completed,
      stopReason: this.stopReason,
    };

    return JSON.stringify(json, null, 2);
  }

  /**
   * Get the full transcript object (for programmatic access).
   */
  getTranscript(): ExplorationTranscript {
    return {
      url: this.options.url,
      goal: this.options.goal,
      turns: this.turns,
      totalTurns: this.totalTurns,
      blockedTurns: this.blockedTurns,
      elapsed: this.elapsed,
      completed: this.completed,
      stopReason: this.stopReason,
    };
  }
}

// ─── File I/O ────────────────────────────────────────────────────────────────

/**
 * Create the transcript directory if it doesn't exist.
 * Returns the directory path.
 */
export function createTranscriptDir(dir: string): string {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate a filename from the transcript URL.
 * Converts URL to a filesystem-safe string.
 */
function generateFileName(transcript: Transcript): string {
  const url = transcript.getTranscript().url;
  const safeUrl = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeUrl}-${timestamp}.json`;
}

/**
 * Save a transcript to a JSON file in the given directory.
 * Creates the directory if it doesn't exist.
 * Returns the full file path.
 */
export function saveTranscriptToFile(
  transcript: Transcript,
  dir: string
): string {
  const safeDir = createTranscriptDir(dir);
  const fileName = generateFileName(transcript);
  const filePath = join(safeDir, fileName);

  writeFileSync(filePath, transcript.toJson(), "utf-8");
  return filePath;
}

/**
 * Load a transcript from a JSON file.
 * Returns the parsed ExplorationTranscript object.
 */
export function loadTranscriptFromFile(filePath: string): ExplorationTranscript {
  if (!existsSync(filePath)) {
    throw new ExplorerError(
      `Transcript file not found: ${filePath}`
    );
  }

  const content = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content) as ExplorationTranscript;

  // Validate required fields
  if (!parsed.url || !parsed.goal || !Array.isArray(parsed.turns)) {
    throw new ExplorerError(
      `Invalid transcript file: missing required fields (url, goal, turns)`
    );
  }

  return parsed;
}

// ─── Script Assembly ─────────────────────────────────────────────────────────

/**
 * Options for script assembly.
 */
export interface ScriptAssemblyOptions {
  /** Demo script title */
  title: string;
  /** Narration mode */
  narration_mode: "captions" | "tts" | "none";
  /** Viewport configuration (optional, defaults to 1280x720) */
  viewport?: { width: number; height: number; scale?: number };
}

/**
 * Assembles a Demo Script from exploration transcript turns.
 *
 * Collects all non-blocked turns, converts LLM actions to DemoStep objects,
 * validates against the T2 schema, and returns a valid Demo Script.
 */
export class ScriptAssembly {
  private options: ScriptAssemblyOptions;
  private steps: DemoStep[] = [];

  constructor(options: ScriptAssemblyOptions) {
    this.options = options;
  }

  /**
   * Add a turn to the assembly.
   * Only non-blocked turns with a selectedAction are converted to steps.
   */
  addTurn(turn: ExplorationTurn): void {
    if (turn.blocked) {
      return;
    }

    const action = turn.selectedAction;
    if (!action) {
      return;
    }

    const step = buildDemoStep(action);
    if (step) {
      this.steps.push(step);
    }
  }

  /**
   * Assemble all collected turns into a Demo Script.
   * Adds a `done` step at the end if missing.
   * Validates against the T2 schema.
   */
  assemble(): ScriptAssemblyResult {
    // Ensure the script ends with a done step
    const lastStep = this.steps[this.steps.length - 1];
    if (!lastStep || !("done" in lastStep)) {
      this.steps.push({ done: true });
    }

    const script: DemoScript = {
      demo: this.options.title,
      title: this.options.title,
      viewport: {
        width: this.options.viewport?.width ?? 1280,
        height: this.options.viewport?.height ?? 720,
        scale: (this.options.viewport?.scale ?? 1) as 1,
      },
      narration_mode: this.options.narration_mode,
      steps: this.steps,
    };

    // Validate against T2 schema
    const validation = validateDemoScript(script);
    if (!validation.success) {
      const zodError = validation.error;
      const issues = (zodError as unknown as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
      return {
        script,
        valid: false,
        errors: issues.map(
          (e) => `${(e.path as string[]).join(".")}: ${e.message}`
        ),
      };
    }

    return { script, valid: true };
  }

  /**
   * Get the assembled steps (before final assembly).
   */
  getSteps(): DemoStep[] {
    return [...this.steps];
  }
}

/**
 * Convenience function to build a Demo Script from turns.
 */
export function buildDemoScriptFromTranscript(
  turns: ExplorationTurn[],
  options: ScriptAssemblyOptions
): ScriptAssemblyResult {
  const assembly = new ScriptAssembly(options);
  for (const turn of turns) {
    assembly.addTurn(turn);
  }
  return assembly.assemble();
}

// ─── Demo Step Builder ───────────────────────────────────────────────────────

/**
 * Converts an LLM action response into a DemoStep.
 * Returns null if the action cannot be converted.
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

// ─── Human Confirmation UI ───────────────────────────────────────────────────

/**
 * Options for HumanConfirmUI.
 */
export interface HumanConfirmUIOptions {
  /** Callback that receives proposed flows and returns a confirmation result */
  onConfirm: ConfirmCallback;
}

/**
 * Human confirmation UI for explorer agent.
 *
 * Presents proposed flows to the user and waits for accept/reject/modify.
 * The actual UI presentation is delegated to the onConfirm callback,
 * allowing different implementations (CLI, web, etc.).
 */
export class HumanConfirmUI {
  private options: HumanConfirmUIOptions;

  constructor(options: HumanConfirmUIOptions) {
    this.options = options;
  }

  /**
   * Present proposed flows to the user and wait for confirmation.
   *
   * @param proposedFlows - List of proposed flow descriptions
   * @returns Confirmation result with decision and selected flows
   */
  async present(proposedFlows: string[]): Promise<HumanConfirmationResult> {
    const result = await this.options.onConfirm(proposedFlows);

    return {
      decision: result.decision,
      selectedFlows: result.selectedFlows,
      confirmed: result.decision !== "reject",
    };
  }

  /**
   * Present flows and return true if accepted.
   * Convenience method for simple accept/reject scenarios.
   */
  async accept(proposedFlows: string[]): Promise<boolean> {
    const result = await this.present(proposedFlows);
    return result.decision === "accept";
  }

  /**
   * Present flows and return the selected flows.
   * Convenience method for accept/modify scenarios.
   */
  async getSelected(proposedFlows: string[]): Promise<string[]> {
    const result = await this.present(proposedFlows);
    return result.selectedFlows;
  }
}
