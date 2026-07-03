/**
 * DemoForge renderer package — replay engine and video capture.
 */

export { Renderer, RenderError } from './replay/renderer.js';
export { stabilityDetect, type StabilityResult } from './replay/stability.js';
export { detectCSP, type CSPResult } from './replay/csp.js';
export { accessibilityDiff } from './replay/accessibility.js';
export type {
  RenderConfig,
  RenderResult,
  StepAction,
  StepFailure,
  StepResult,
  StepResultSuccess,
  StepResultFailure,
  StepResultTimeout,
  StepResultTiming,
  GotoAction,
  ClickAction,
  HoverAction,
  FillAction,
  SelectAction,
  PressAction,
  WaitForAction,
  NarrateAction,
  ScreenshotAction,
  MarkFlowStartAction,
  MarkFlowEndAction,
  DoneAction,
  PauseAction,
} from './replay/types.js';
