/**
 * DemoForge explorer — guardrails and budget enforcement.
 *
 * The `Guardrails` class encapsulates all safety checks for the explorer agent:
 * - Origin allowlist: only actions within configured origins are allowed
 * - Destructive action denylist: block buttons/routes like "Delete account"
 * - Step budget: hard limit on total steps per exploration
 * - Time budget: hard limit on total exploration time
 * - Budget exceeded handling: stop exploration, emit partial script with budget warning
 *
 * Guardrails are applied before each LLM call and after each response parsing.
 * Configurable per-project in demoforge.yaml under `explorer.guardrails`.
 */

import type { DemoScript, DemoStep } from "../types/index.js";
import { validateDemoScript } from "../schema/demoScriptSchema.js";

// ─── Budget Status ───────────────────────────────────────────────────────────

/**
 * Status result from budget checks.
 */
export interface BudgetStatus {
  /** Whether the budget has been exceeded */
  exceeded: boolean;
  /** Whether approaching the budget (within 10%) */
  warning: boolean;
  /** Human-readable message */
  message: string;
  /** Remaining steps or ms */
  remaining: number;
  /** Threshold percentage for warning (0.1 = 10%) */
  threshold: number;
}

// ─── Guardrails Config ───────────────────────────────────────────────────────

/**
 * Full guardrails configuration for the explorer agent.
 * Mapped from demoforge.yaml `explorer` section.
 */
export interface GuardrailsConfig {
  /** Allowed origins (URL patterns). Empty = allow all. */
  allowedOrigins?: string[];
  /** Destructive button text patterns to block (case-insensitive) */
  destructiveButtonPatterns?: string[];
  /** Destructive URL patterns to block (case-insensitive) */
  destructiveUrlPatterns?: string[];
  /** Maximum number of exploration steps */
  maxSteps?: number;
  /** Maximum exploration time in milliseconds */
  maxTime?: number;
}

/** Default configuration values. */
const DEFAULT_MAX_STEPS = 50;
const DEFAULT_MAX_TIME = 60000; // 60 seconds

// ─── Transcript Entry ────────────────────────────────────────────────────────

/**
 * A single entry in the guardrails transcript.
 */
interface TranscriptEntry {
  turn: number;
  action: string;
  params?: Record<string, unknown>;
  result?: string;
  blocked: boolean;
  blockReason?: string;
}

// ─── Partial Script ──────────────────────────────────────────────────────────

/**
 * Partial script emitted when a budget is exceeded.
 * Contains the steps collected so far plus a warning.
 */
export interface PartialScript {
  /** The steps collected so far (excludes blocked actions) */
  steps: DemoStep[];
  /** Stop reason (e.g., "max_steps", "max_time", "done") */
  stopReason: string;
  /** Budget warning message, if applicable */
  warning?: string;
  /** Full transcript entries for debugging */
  turns: TranscriptEntry[];
}

// ─── Action Check Result ─────────────────────────────────────────────────────

/**
 * Result of checking an action against guardrails.
 */
interface ActionCheckResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason if blocked (undefined if allowed) */
  reason?: string;
}

// ─── Utility: Normalize for pattern matching ─────────────────────────────────

/**
 * Normalizes a string for comparison: lowercases, replaces hyphens/underscores
 * with spaces, and trims.
 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, " ").trim();
}

// ─── Utility: Check hostname match ───────────────────────────────────────────

/**
 * Checks if a URL's hostname matches an allowed origin.
 * Supports exact hostname match and subdomain matching.
 */
function matchesOrigin(url: string, origin: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const parsedOrigin = new URL(origin);
    const urlHostname = parsedUrl.hostname;
    const originHostname = parsedOrigin.hostname;

    // Exact match
    if (urlHostname === originHostname) return true;

    // Subdomain match: origin.example.com matches app.origin.example.com
    if (urlHostname.endsWith("." + originHostname)) return true;

    return false;
  } catch {
    // If origin can't be parsed as URL, try prefix match
    return url.startsWith(origin);
  }
}

// ─── Guardrails Class ────────────────────────────────────────────────────────

/**
 * Guardrails and budget enforcement for the explorer agent.
 *
 * Encapsulates:
 * - Origin allowlist enforcement
 * - Destructive action denylist (configurable)
 * - Step budget enforcement
 * - Time budget enforcement
 * - Budget exceeded handling: stop exploration, emit partial script with budget warning
 *
 * Usage:
 *   const g = new Guardrails(config);
 *   g.checkBeforeLlmCall();      // validate config before LLM call
 *   const r = g.checkAfterResponse(action); // validate parsed LLM response
 *   g.recordStep();              // increment step counter
 *   g.checkStepBudget();         // check if step budget exceeded
 *   g.checkTimeBudget();         // check if time budget exceeded
 *   g.addTranscriptEntry(...)    // record an action
 *   const partial = g.emitPartialScript("max_steps"); // emit partial script
 */
export class Guardrails {
  private config: Required<GuardrailsConfig>;
  private stepCount = 0;
  private startTime = 0;
  private transcript: TranscriptEntry[] = [];

  constructor(config: GuardrailsConfig = {}) {
    this.config = {
      allowedOrigins: config.allowedOrigins ?? [],
      destructiveButtonPatterns: config.destructiveButtonPatterns ?? [],
      destructiveUrlPatterns: config.destructiveUrlPatterns ?? [],
      maxSteps: config.maxSteps ?? DEFAULT_MAX_STEPS,
      maxTime: config.maxTime ?? DEFAULT_MAX_TIME,
    };
    this.startTime = Date.now();
  }

  /**
   * Create Guardrails from a demoforge.yaml config object.
   * Reads from `config.explorer` section.
   */
  static fromConfig(config: Record<string, unknown>): Guardrails {
    const explorer = (config.explorer as Record<string, unknown>) ?? {};
    const guardrails = (explorer.guardrails as Record<string, unknown>) ?? {};

    return new Guardrails({
      maxSteps: typeof explorer.maxSteps === "number" ? explorer.maxSteps : DEFAULT_MAX_STEPS,
      maxTime: typeof explorer.maxTime === "number" ? explorer.maxTime : DEFAULT_MAX_TIME,
      allowedOrigins: Array.isArray(guardrails.allowedOrigins)
        ? (guardrails.allowedOrigins as string[])
        : [],
      destructiveButtonPatterns: Array.isArray(guardrails.destructiveButtonPatterns)
        ? (guardrails.destructiveButtonPatterns as string[])
        : [],
      destructiveUrlPatterns: Array.isArray(guardrails.destructiveUrlPatterns)
        ? (guardrails.destructiveUrlPatterns as string[])
        : [],
    });
  }

  /** The current guardrails configuration. */
  get config(): Required<GuardrailsConfig> {
    return this.config;
  }

  /** Current step count. */
  get stepCount(): number {
    return this.stepCount;
  }

  /** Remaining steps before budget is exceeded. */
  get remainingSteps(): number {
    return Math.max(0, this.config.maxSteps - this.stepCount);
  }

  /** Elapsed time in milliseconds. */
  get elapsedTime(): number {
    return Date.now() - this.startTime;
  }

  // ─── Origin Allowlist ────────────────────────────────────────────────────

  /**
   * Check if a URL is within the allowed origins.
   * Returns { allowed: true } if no origins are configured (allow all).
   */
  checkOrigin(url: string): ActionCheckResult {
    if (!this.config.allowedOrigins || this.config.allowedOrigins.length === 0) {
      return { allowed: true };
    }

    try {
      const parsedUrl = new URL(url);
      const isAllowed = this.config.allowedOrigins.some((origin) =>
        matchesOrigin(url, origin)
      );

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `blocked by guardrail: URL "${url}" is outside allowed origins (${this.config.allowedOrigins.join(", ")})`,
        };
      }
    } catch {
      // Malformed URL — allow it through (will fail on actual navigation)
    }

    return { allowed: true };
  }

  // ─── Destructive Action Denylist ─────────────────────────────────────────

  /**
   * Check if an action targets a destructive button.
   * Checks both the selector name and the action notes.
   * Returns the matched pattern name, or null if not destructive.
   */
  private checkDestructiveButton(action: { action: string; params?: Record<string, unknown>; notes?: string }): string | null {
    if (!this.config.destructiveButtonPatterns || this.config.destructiveButtonPatterns.length === 0) {
      return null;
    }

    const params = action.params as Record<string, unknown> | undefined;
    const selector = params?.selector as string | undefined;
    const notes = (action.notes as string) || "";

    // Check selector
    if (selector) {
      const normalizedSelector = normalizeForMatch(selector);
      for (const pattern of this.config.destructiveButtonPatterns) {
        const normalizedPattern = normalizeForMatch(pattern);
        if (normalizedSelector.includes(normalizedPattern)) {
          return pattern;
        }
      }
    }

    // Check notes
    if (notes) {
      const normalizedNotes = normalizeForMatch(notes);
      for (const pattern of this.config.destructiveButtonPatterns) {
        const normalizedPattern = normalizeForMatch(pattern);
        if (normalizedNotes.includes(normalizedPattern)) {
          return pattern;
        }
      }
    }

    return null;
  }

  /**
   * Check if a URL matches any destructive URL patterns.
   */
  private isDestructiveUrl(url: string): boolean {
    if (!this.config.destructiveUrlPatterns || this.config.destructiveUrlPatterns.length === 0) {
      return false;
    }

    const urlLower = url.toLowerCase();
    for (const pattern of this.config.destructiveUrlPatterns) {
      if (urlLower.includes(pattern.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  // ─── Main Action Check ───────────────────────────────────────────────────

  /**
   * Full guardrails check for an LLM action response.
   * Checks origin allowlist, destructive buttons, and destructive URLs.
   */
  checkAction(action: { action: string; params?: Record<string, unknown>; notes?: string }): ActionCheckResult {
    const params = action.params as Record<string, unknown> | undefined;

    // Check destructive buttons
    const matchedPattern = this.checkDestructiveButton(action);
    if (matchedPattern) {
      return {
        allowed: false,
        reason: `blocked by guardrail: action targets destructive button pattern "${matchedPattern}"`,
      };
    }

    // Check destructive URLs (only for goto actions)
    if (action.action === "goto" && params?.url) {
      const url = params.url as string;
      if (this.isDestructiveUrl(url)) {
        return {
          allowed: false,
          reason: `blocked by guardrail: URL "${url}" matches destructive pattern`,
        };
      }
    }

    // Check origin allowlist (only for goto actions)
    if (action.action === "goto" && params?.url) {
      const url = params.url as string;
      const originResult = this.checkOrigin(url);
      if (!originResult.allowed) {
        return originResult;
      }
    }

    return { allowed: true };
  }

  // ─── Budget Enforcement ──────────────────────────────────────────────────

  /**
   * Record a step (increment step counter).
   */
  recordStep(): void {
    this.stepCount++;
  }

  /**
   * Check if the step budget has been exceeded or is approaching.
   */
  checkStepBudget(): BudgetStatus {
    const remaining = this.config.maxSteps - this.stepCount;
    const exceeded = remaining <= 0;
    const threshold = Math.ceil(this.config.maxSteps * 0.1); // 10% threshold
    const warning = remaining <= threshold && remaining > 0;

    let message: string;
    if (exceeded) {
      message = `Step budget exceeded: ${this.stepCount}/${this.config.maxSteps} steps used`;
    } else if (warning) {
      message = `Step budget warning: ${remaining} steps remaining (${this.stepCount}/${this.config.maxSteps})`;
    } else {
      message = `Step budget OK: ${remaining} steps remaining`;
    }

    return {
      exceeded,
      warning,
      message,
      remaining,
      threshold: 0.1,
    };
  }

  /**
   * Check if the time budget has been exceeded or is approaching.
   */
  checkTimeBudget(): BudgetStatus {
    const elapsed = this.elapsedTime;
    const remaining = Math.max(0, this.config.maxTime - elapsed);
    const exceeded = elapsed >= this.config.maxTime;
    const threshold = Math.ceil(this.config.maxTime * 0.1); // 10% threshold
    const warning = remaining <= threshold && remaining > 0;

    let message: string;
    if (exceeded) {
      message = `Time budget exceeded: ${elapsed}ms / ${this.config.maxTime}ms`;
    } else if (warning) {
      message = `Time budget warning: ${remaining}ms remaining (${elapsed}ms / ${this.config.maxTime}ms)`;
    } else {
      message = `Time budget OK: ${remaining}ms remaining`;
    }

    return {
      exceeded,
      warning,
      message,
      remaining,
      threshold: 0.1,
    };
  }

  // ─── Transcript Entry ────────────────────────────────────────────────────

  /**
   * Add an entry to the guardrails transcript.
   */
  addTranscriptEntry(entry: Omit<TranscriptEntry, "turn"> & { turn?: number }): void {
    this.transcript.push({
      turn: entry.turn ?? this.transcript.length + 1,
      action: entry.action,
      params: entry.params,
      result: entry.result,
      blocked: entry.blocked,
      blockReason: entry.blockReason,
    });
  }

  /** All transcript entries. */
  get transcriptEntries(): TranscriptEntry[] {
    return [...this.transcript];
  }

  // ─── Budget Exceeded Handling ────────────────────────────────────────────

  /**
   * Emit a partial script when a budget is exceeded.
   * Collects all unblocked steps, adds a done step if missing,
   * and includes a budget warning.
   */
  emitPartialScript(stopReason: string): PartialScript {
    const steps: DemoStep[] = [];
    const unblockedTurns = this.transcript.filter((e) => !e.blocked);

    for (const entry of unblockedTurns) {
      const step = this.entryToStep(entry);
      if (step) {
        steps.push(step);
      }
    }

    // Ensure the script ends with a done step
    const lastStep = steps[steps.length - 1];
    if (!lastStep || !("done" in lastStep)) {
      steps.push({ done: true });
    }

    // Build warning message
    let warning: string | undefined;
    if (stopReason === "max_steps") {
      warning = `Exploration stopped: step budget exceeded (${this.stepCount}/${this.config.maxSteps} steps). Partial script with ${steps.length} steps generated.`;
    } else if (stopReason === "max_time") {
      warning = `Exploration stopped: time budget exceeded (${this.elapsedTime}ms / ${this.config.maxTime}ms). Partial script with ${steps.length} steps generated.`;
    }

    return {
      steps,
      stopReason,
      warning,
      turns: this.transcript,
    };
  }

  /**
   * Convert a transcript entry to a DemoStep.
   */
  private entryToStep(entry: TranscriptEntry): DemoStep | null {
    const params = entry.params as Record<string, unknown> | undefined;

    switch (entry.action) {
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
        if (text) return { wait_for: { text } };
        if (selector) return { wait_for: { selector } };
        return null;
      }
      case "narrate": {
        const narration = params?.narration as string || "";
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

  // ─── Guardrails Application Timing ───────────────────────────────────────

  /**
   * Called before each LLM call to validate the guardrails config is ready.
   * No-op for now, but provides a hook for future pre-call validation.
   */
  checkBeforeLlmCall(): void {
    // Validate that config is properly initialized
    if (this.config.maxSteps <= 0) {
      throw new Error("Guardrails: maxSteps must be greater than 0");
    }
    if (this.config.maxTime <= 0) {
      throw new Error("Guardrails: maxTime must be greater than 0");
    }
  }

  /**
   * Called after each LLM response parsing to validate the parsed action.
   * Returns an ActionCheckResult indicating whether the action is allowed.
   */
  checkAfterResponse(action: { action: string; params?: Record<string, unknown>; notes?: string }): ActionCheckResult {
    return this.checkAction(action);
  }

  // ─── Script Assembly ─────────────────────────────────────────────────────

  /**
   * Assemble a DemoScript from the transcript entries.
   * Validates against the T2 schema.
   */
  assembleScript(title: string, narrationMode: string): {
    script: DemoScript;
    valid: boolean;
    errors?: string[];
  } {
    const partial = this.emitPartialScript("done");
    const script: DemoScript = {
      demo: title,
      title,
      viewport: { width: 1440, height: 900, scale: 1 },
      narration_mode: narrationMode as any,
      steps: partial.steps,
    };

    const validation = validateDemoScript(script);
    if (!validation.success) {
      const failure = validation as unknown as {
        success: false;
        error: { errors: Array<{ path: string[]; message: string }> };
      };
      return {
        script,
        valid: false,
        errors: failure.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      };
    }

    return { script, valid: true };
  }
}
