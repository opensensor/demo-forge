/**
 * DemoForge renderer — screenshot annotation and redaction module.
 *
 * Provides:
 * - ScreenshotCapture: full-page and element-scoped screenshots
 * - Annotation primitives: boxes, arrows, blur-redaction
 * - Auto-redaction rules from config (regex patterns)
 * - PNG output with configurable quality
 * - Before/after comparison: side-by-side or overlay mode for diff reports
 */

export { ScreenshotCapture } from './capture.js';
export { applyAnnotations } from './annotation.js';
export { applyRedaction } from './redaction.js';
export { compareScreenshots } from './diff.js';

export type {
  Point,
  Rect,
  BoxAnnotation,
  ArrowAnnotation,
  BlurAnnotation,
  Annotation,
  ScreenshotMode,
  ScreenshotCaptureOptions,
  ScreenshotResult,
  DiffMode,
  DiffOptions,
  DiffResult,
} from './types.js';
