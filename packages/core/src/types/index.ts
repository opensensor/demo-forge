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
  /** Clip the screenshot to this element instead of the viewport. */
  selector?: Selector;
  /** Capture the full scrollable page. */
  full_page?: boolean;
}

/** Scroll action configuration. */
export interface ScrollConfig {
  /** Pixels to scroll vertically (positive = down). */
  amount?: number;
  /** Smoothly scroll this element into view instead of by a fixed amount. */
  to?: Selector;
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
  | "pause"
  | "set_storage"
  | "reload";

/** Navigation step. */
export interface GotoStep {
  goto: string;
  settle?: SettlePolicy;
}

/** Click step. */
export interface ClickStep {
  click: Selector;
  effect?: Effect;
  /** Label shown next to the target while the step plays. */
  callout?: string;
}

/** Hover step. */
export interface HoverStep {
  hover: Selector;
  effect?: Effect;
  /** Label shown next to the target while the step plays. */
  callout?: string;
}

/** Fill step. */
export interface FillStep {
  fill: FillConfig;
  effect?: Effect;
  /** Label shown next to the target while the step plays. */
  callout?: string;
}

/** Select step. */
export interface SelectStep {
  select: SelectConfig;
  effect?: Effect;
  /** Label shown next to the target while the step plays. */
  callout?: string;
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
  /** Label shown next to the target while the step plays. */
  callout?: string;
}

/** Narrate step. */
export interface NarrateStep {
  narrate: string;
  /**
   * Hold the replay until the narration finishes speaking (or, without TTS,
   * until it has been on screen long enough to read). Default: true.
   */
  wait?: boolean;
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

/** Write localStorage entries on the current page's origin. */
export interface SetStorageStep {
  set_storage: Record<string, string>;
}

/** Reload the current page. */
export interface ReloadStep {
  reload: true;
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
  | PauseStep
  | SetStorageStep
  | ReloadStep;

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
  /** Base URL of the app under demo (used as the replay entry point). */
  url?: string;
  viewport: Viewport;
  narration_mode: NarrationMode;
  steps: DemoStep[];
  render_matrix?: RenderMatrix;
  /**
   * Steps run in a separate, unrecorded browser before the demo (e.g. login).
   * Cookies and storage they produce carry over into the recorded session.
   */
  setup?: DemoStep[];
  /** Browser state applied before any page script runs. */
  init?: ScriptInit;
  /** Show the synthetic cursor and click ripples. Default: true. */
  cursor?: boolean;
  /** TTS voice for narration (backend-specific, e.g. Kokoro "af_heart"). */
  voice?: string;
  /**
   * CSS selectors whose elements are blurred in every frame and screenshot
   * (credentials, internal URLs, personal data).
   */
  redact?: string[];
}

/** Browser state applied before any page script runs. */
export interface ScriptInit {
  /**
   * localStorage entries seeded before page scripts run. Keys already set
   * (e.g. by a `set_storage` step) are left alone.
   */
  local_storage?: Record<string, string>;
  /** Emulated prefers-color-scheme. */
  color_scheme?: "light" | "dark";
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

export function isSetStorageStep(step: DemoStep): step is SetStorageStep {
  return "set_storage" in step;
}

export function isReloadStep(step: DemoStep): step is ReloadStep {
  return "reload" in step;
}
