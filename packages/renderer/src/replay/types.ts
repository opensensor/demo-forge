/**
 * DemoForge renderer — type definitions for script replay.
 */

// ─── Step Execution Types ────────────────────────────────────────────────────

export interface GotoAction {
  type: 'goto';
  url: string;
  settle: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickAction {
  type: 'click';
  selector: import('@demoforge/core').Selector;
}

export interface HoverAction {
  type: 'hover';
  selector: import('@demoforge/core').Selector;
}

export interface FillAction {
  type: 'fill';
  selector: import('@demoforge/core').Selector;
  value: string;
}

export interface SelectAction {
  type: 'select';
  selector: import('@demoforge/core').Selector;
  value: string;
}

export interface PressAction {
  type: 'press';
  key: string;
}

export interface WaitForAction {
  type: 'wait_for';
  condition: import('@demoforge/core').WaitForCondition;
}

export interface NarrateAction {
  type: 'narrate';
  text: string;
}

export interface ScreenshotAction {
  type: 'screenshot';
}

export interface MarkFlowStartAction {
  type: 'mark_flow_start';
  name: string;
}

export interface MarkFlowEndAction {
  type: 'mark_flow_end';
  name: string;
}

export interface DoneAction {
  type: 'done';
}

export interface PauseAction {
  type: 'pause';
  duration: number;
}

export type StepAction =
  | GotoAction
  | ClickAction
  | HoverAction
  | FillAction
  | SelectAction
  | PressAction
  | WaitForAction
  | NarrateAction
  | ScreenshotAction
  | MarkFlowStartAction
  | MarkFlowEndAction
  | DoneAction
  | PauseAction;

// ─── Render Configuration ───────────────────────────────────────────────────

export interface RenderConfig {
  /** Global timeout for entire render in milliseconds. Default: 120000 (2 min). */
  globalTimeout?: number;
  /** Per-step timeout in milliseconds. Default: 30000. */
  stepTimeout?: number;
  /** Default settle policy for navigation steps. Default: 'load'. */
  defaultSettle?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Directory for output artifacts (screenshots, AX diffs). */
  outputDir?: string;
  /** Whether to capture screenshots on step failure. Default: true. */
  captureOnFailure?: boolean;
  /** Whether to compute AX diffs on step failure. Default: true. */
  computeAxDiffOnFailure?: boolean;
  /** Number of stability render attempts. Default: 3. */
  stabilityAttempts?: number;
}

// ─── Step Result ─────────────────────────────────────────────────────────────

export interface StepFailure {
  error: string;
  screenshot?: Buffer;
  axDiff?: string;
  stepIndex: number;
  stepType: string;
}

export interface StepResultSuccess {
  status: 'success';
  stepIndex: number;
  stepType: string;
  duration: number;
}

export interface StepResultFailure {
  status: 'failure';
  stepIndex: number;
  stepType: string;
  duration: number;
  error: string;
  screenshot?: Buffer;
  axDiff?: string;
}

export interface StepResultTimeout {
  status: 'timeout';
  stepIndex: number;
  stepType: string;
  duration: number;
  timeoutMs: number;
}

export interface StepResultTiming {
  status: 'timing';
  stepIndex: number;
  stepType: string;
  duration: number;
}

export type StepResult =
  | StepResultSuccess
  | StepResultFailure
  | StepResultTimeout
  | StepResultTiming;

// ─── Render Result ───────────────────────────────────────────────────────────

export interface RenderResult {
  steps: StepResult[];
  totalDuration: number;
  status: 'success' | 'failure' | 'timeout';
  stepCount: number;
  outputDir?: string;
  warnings: string[];
  cspDetected?: boolean;
}
