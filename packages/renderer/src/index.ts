/**
 * DemoForge renderer package — replay engine and video capture.
 */

export { Renderer, RenderError } from './replay/renderer.js';
export { stabilityDetect, type StabilityResult } from './replay/stability.js';
export { detectCSP, type CSPResult } from './replay/csp.js';
export { accessibilityDiff } from './replay/accessibility.js';
export { VirtualTimeController } from './virtual-time/controller.js';
export type { VirtualTimeConfig } from './virtual-time/controller.js';
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

export { Cursor } from './cursor/cursor.js';
export type {
  CursorConfig,
  CursorStyle,
  CursorActionPoint,
  CursorMoveOptions,
} from './cursor/cursor.js';
export {
  cubicBezier,
  easeInOut,
  easeOut,
  easeIn,
  easeOutBounce,
  linear,
} from './cursor/easing.js';
