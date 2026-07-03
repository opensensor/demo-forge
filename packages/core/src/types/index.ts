/**
 * Core type definitions for DemoForge.
 *
 * These types describe the structure of a Demo Script and its components.
 */

/** Supported viewport scale factors. */
export type ScaleFactor = 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4;

/** Viewport dimensions for rendering. */
export interface Viewport {
  width: number;
  height: number;
  scale: ScaleFactor;
}

/** Supported visual effects. */
export type Effect = "highlight" | "zoom" | "dim" | "callout";

/** Supported narration modes. */
export type NarrationMode = "captions" | "tts" | "none";

/** Typing simulation style. */
export type TypingStyle = "natural" | "instant";

/** Settle policy after navigation. */
export type SettlePolicy = "networkidle" | "domcontentloaded" | "load";

/** Wait-for condition types. */
export interface WaitForTextCondition {
  text: string;
  timeout?: number;
}

export interface WaitForSelectorCondition {
  selector: Selector;
  state?: "visible" | "hidden" | "attached" | "detached";
  timeout?: number;
}

export type WaitForCondition = WaitForTextCondition | WaitForSelectorCondition;

/** Annotation targets for screenshots. */
export type AnnotationTarget = "target" | "viewport" | "all";

/** Selector types for targeting page elements. */
export type Selector =
  | { role: string; name?: string }
  | { label: string }
  | { text: string }
  | { css: string }
  | { xpath: string }
  | string;

/** Fill action input configuration. */
export interface FillConfig {
  target: Selector;
  value: string;
  typing?: TypingStyle;
}

/** Select action configuration. */
export interface SelectConfig {
  target: Selector;
  value: string;
}

/** Screenshot configuration. */
export interface ScreenshotConfig {
  name?: string;
  annotate?: AnnotationTarget[];
}

/** Scroll action configuration. */
export interface ScrollConfig {
  amount: number;
}

/** Press action configuration. */
export interface PressConfig {
  key: string;
}

/** Flow marker configuration. */
export interface FlowMarker {
  name: string;
}

/**
 * Action categories for grouping steps.
 */
export type ActionCategory =
  | "navigation"
  | "interaction"
  | "input"
  | "assertion"
  | "narration"
  | "capture"
  | "flow_control"
  | "timing";

/**
 * All supported action types.
 */
export type ActionType =
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

/** Navigation step. */
export interface GotoStep {
  goto: string;
  settle?: SettlePolicy;
}

/** Click step. */
export interface ClickStep {
  click: Selector;
  effect?: Effect;
}

/** Hover step. */
export interface HoverStep {
  hover: Selector;
  effect?: Effect;
}

/** Fill step. */
export interface FillStep {
  fill: FillConfig;
  effect?: Effect;
}

/** Select step. */
export interface SelectStep {
  select: SelectConfig;
  effect?: Effect;
}

/** Press step. */
export interface PressStep {
  press: PressConfig;
  effect?: Effect;
}

/** Scroll step. */
export interface ScrollStep {
  scroll: ScrollConfig;
  effect?: Effect;
}

/** Wait-for step. */
export interface WaitForStep {
  wait_for: WaitForCondition;
  effect?: Effect;
}

/** Narrate step. */
export interface NarrateStep {
  narrate: string;
}

/** Screenshot step. */
export interface ScreenshotStep {
  screenshot: ScreenshotConfig;
}

/** Mark flow start step. */
export interface MarkFlowStartStep {
  mark_flow_start: FlowMarker;
}

/** Mark flow end step. */
export interface MarkFlowEndStep {
  mark_flow_end: FlowMarker;
}

/** Done step. */
export interface DoneStep {
  done: true;
}

/** Pause step. */
export interface PauseStep {
  pause: number;
}

/**
 * Discriminated union of all step types.
 * Each step has exactly one action key.
 */
export type DemoStep =
  | GotoStep
  | ClickStep
  | HoverStep
  | FillStep
  | SelectStep
  | PressStep
  | ScrollStep
  | WaitForStep
  | NarrateStep
  | ScreenshotStep
  | MarkFlowStartStep
  | MarkFlowEndStep
  | DoneStep
  | PauseStep;

/** Narration configuration. */
export interface NarrationConfig {
  mode: NarrationMode;
  voice?: string;
  speed?: number;
}

/** Viewport definition for render matrix cells. */
export interface ViewportConfig {
  width: number;
  height: number;
}

/** Render cell configuration. */
export interface RenderCell {
  viewport: ViewportConfig;
  theme?: "light" | "dark";
  locale?: string;
}

/** Render matrix for producing multiple output variations. */
export interface RenderMatrix {
  viewports: ViewportConfig[];
  themes?: ("light" | "dark")[];
  locales?: string[];
}

/**
 * The top-level Demo Script structure.
 * This is what gets loaded from YAML/JSON and validated.
 */
export interface DemoScript {
  demo: string;
  title: string;
  viewport: Viewport;
  narration_mode: NarrationMode;
  steps: DemoStep[];
  render_matrix?: RenderMatrix;
}

/**
 * Type guard helpers for discriminated union narrowing.
 */
export function isGotoStep(step: DemoStep): step is GotoStep {
  return "goto" in step;
}

export function isClickStep(step: DemoStep): step is ClickStep {
  return "click" in step;
}

export function isHoverStep(step: DemoStep): step is HoverStep {
  return "hover" in step;
}

export function isFillStep(step: DemoStep): step is FillStep {
  return "fill" in step;
}

export function isSelectStep(step: DemoStep): step is SelectStep {
  return "select" in step;
}

export function isPressStep(step: DemoStep): step is PressStep {
  return "press" in step;
}

export function isScrollStep(step: DemoStep): step is ScrollStep {
  return "scroll" in step;
}

export function isWaitForStep(step: DemoStep): step is WaitForStep {
  return "wait_for" in step;
}

export function isNarrateStep(step: DemoStep): step is NarrateStep {
  return "narrate" in step;
}

export function isScreenshotStep(step: DemoStep): step is ScreenshotStep {
  return "screenshot" in step;
}

export function isMarkFlowStartStep(step: DemoStep): step is MarkFlowStartStep {
  return "mark_flow_start" in step;
}

export function isMarkFlowEndStep(step: DemoStep): step is MarkFlowEndStep {
  return "mark_flow_end" in step;
}

export function isDoneStep(step: DemoStep): step is DoneStep {
  return "done" in step;
}

export function isPauseStep(step: DemoStep): step is PauseStep {
  return "pause" in step;
}
