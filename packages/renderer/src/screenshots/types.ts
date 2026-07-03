/**
 * DemoForge renderer — screenshot annotation and redaction types.
 */

import type { Selector } from '@demoforge/browser';
import type { RedactionRule } from '@demoforge/core';

// ─── Annotation Primitives ───────────────────────────────────────────────────

/** A point in pixel coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** A rectangle defined by top-left corner and dimensions. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Draw a colored rectangle border. */
export interface BoxAnnotation {
  type: 'box';
  /** Bounding rectangle of the box. */
  rect: Rect;
  /** Border color in CSS format (hex, rgb, or named). Default: '#ff0000'. */
  color?: string;
  /** Border width in pixels. Default: 2. */
  borderWidth?: number;
  /** Optional label text to render inside the box. */
  label?: string;
}

/** Draw a line with an arrowhead from start to end. */
export interface ArrowAnnotation {
  type: 'arrow';
  /** Starting point of the arrow. */
  from: Point;
  /** Ending point of the arrow. */
  to: Point;
  /** Line color in CSS format. Default: '#ff0000'. */
  color?: string;
  /** Line width in pixels. Default: 2. */
  lineWidth?: number;
  /** Arrowhead size in pixels. Default: 10. */
  arrowSize?: number;
  /** Optional label text to render near the arrow. */
  label?: string;
}

/** Apply Gaussian blur to a rectangular region. */
export interface BlurAnnotation {
  type: 'blur';
  /** Bounding rectangle to blur. */
  rect: Rect;
  /** Blur sigma (radius). Higher = more blur. Default: 10. */
  sigma?: number;
}

/** A single annotation to overlay on a screenshot. */
export type Annotation = BoxAnnotation | ArrowAnnotation | BlurAnnotation;

// ─── Screenshot Capture ──────────────────────────────────────────────────────

/** Type of screenshot to capture. */
export type ScreenshotMode = 'full-page' | 'element';

/** Options for capturing a screenshot. */
export interface ScreenshotCaptureOptions {
  /** Screenshot mode. Default: 'full-page'. */
  mode?: ScreenshotMode;
  /** Element selector when mode is 'element'. */
  elementSelector?: Selector;
  /** Output PNG quality (0-100). Default: 95. */
  quality?: number;
  /** Output file path. If omitted, returns buffer only. */
  outputPath?: string;
  /** Annotations to apply to the screenshot. */
  annotations?: Annotation[];
  /** Redaction rules to apply (regex patterns). */
  redactionRules?: RedactionRule[];
  /** Text strings to redact (auto-detect sensitive patterns). */
  autoRedact?: boolean;
  /** Screenshot format. Default: 'png'. */
  format?: 'png';
}

/** Result of a screenshot capture. */
export interface ScreenshotResult {
  /** The screenshot buffer (PNG). */
  buffer: Buffer;
  /** Page URL at time of capture. */
  url: string;
  /** Page title at time of capture. */
  title: string;
  /** Viewport dimensions. */
  viewport: { width: number; height: number };
  /** Full page dimensions (may exceed viewport for full-page captures). */
  dimensions: { width: number; height: number };
  /** Annotations that were applied. */
  annotationsApplied: number;
  /** Redactions that were applied. */
  redactionsApplied: number;
  /** Output file path if saved, undefined otherwise. */
  outputPath?: string;
}

// ─── Diff / Comparison ───────────────────────────────────────────────────────

/** Mode for comparing two screenshots. */
export type DiffMode = 'side-by-side' | 'overlay';

/** Options for before/after screenshot comparison. */
export interface DiffOptions {
  /** Comparison mode. Default: 'side-by-side'. */
  mode?: DiffMode;
  /** Label for the before image. Default: 'Before'. */
  beforeLabel?: string;
  /** Label for the after image. Default: 'After'. */
  afterLabel?: string;
  /** Spacing between images in side-by-side mode. Default: 20. */
  spacing?: number;
  /** Background color for the diff canvas. Default: '#1a1a2e'. */
  backgroundColor?: string;
  /** Font size for labels in pixels. Default: 16. */
  labelFontSize?: number;
  /** Output PNG quality. Default: 95. */
  quality?: number;
  /** Output file path. If omitted, returns buffer only. */
  outputPath?: string;
}

/** Result of a before/after diff comparison. */
export interface DiffResult {
  /** Combined diff image buffer. */
  buffer: Buffer;
  /** Pixel difference count (number of different pixels). */
  pixelDiff: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Similarity ratio (0-1, 1 = identical). */
  similarity: number;
  /** Output file path if saved. */
  outputPath?: string;
}
