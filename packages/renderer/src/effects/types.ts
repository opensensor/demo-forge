/**
 * DemoForge renderer — effects type definitions.
 *
 * Types for visual effects: zoom/pan (Ken Burns), spotlight/dim,
 * callout labels, and smooth scroll easing.
 */

// ─── Effect Style Configuration ──────────────────────────────────────────────

export interface EffectStyle {
  /** Color for highlight rings and emphasis. Default: #fbbf24 (amber-400). */
  highlightColor: string;
  /** CSS box-shadow or ring for highlighted elements. */
  highlightRing: string;
  /** Dim amount for non-target content (0 = no dim, 1 = fully dark). Default: 0.4. */
  dimAmount: number;
  /** Callout label background color. Default: #1e293b (slate-800). */
  calloutBg: string;
  /** Callout label text color. Default: #f8fafc (slate-50). */
  calloutText: string;
  /** Callout label font family. Default: system-ui, sans-serif. */
  calloutFontFamily: string;
  /** Callout label font size. Default: 13px. */
  calloutFontSize: string;
  /** Zoom/pan transition duration in ms. Default: 600. */
  zoomDuration: number;
  /** Default zoom scale factor. Default: 1.3. */
  zoomScale: number;
  /** Dim overlay fade-in duration in ms. Default: 400. */
  dimDuration: number;
  /** Callout label fade-in duration in ms. Default: 300. */
  calloutDuration: number;
  /** CSS cubic-bezier string for smooth scroll easing. Default: ease-in-out. */
  scrollEasing: string;
  /** Smooth scroll duration in ms. Default: 500. */
  scrollDuration: number;
}

// ─── Effect Configuration ────────────────────────────────────────────────────

export interface EffectConfig {
  /** Whether effects are enabled. Default: true. */
  enabled: boolean;
  /** Visual style configuration. */
  style: EffectStyle;
}

// ─── Effect Step Types ───────────────────────────────────────────────────────

export type CalloutPosition =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface ZoomEffect {
  type: 'zoom';
  /** Scale factor (1 = no zoom, >1 = zoom in). Default: 1.3. */
  scale: number;
  /** Horizontal pan offset (0-1, where 0 = left, 0.5 = center, 1 = right). Default: 0.5. */
  x?: number;
  /** Vertical pan offset (0-1, where 0 = top, 0.5 = center, 1 = bottom). Default: 0.5. */
  y?: number;
  /** Transition duration in ms. Defaults to style.zoomDuration. */
  duration?: number;
  /** Absolute timestamp (ms) for synchronized scheduling. Default: 0. */
  atTime: number;
}

export interface DimEffect {
  type: 'dim';
  /** CSS selector for the target element to keep bright. */
  selector: string;
  /** Dim amount (0 = no dim, 1 = fully dark). Defaults to style.dimAmount. */
  dimAmount?: number;
  /** Fade duration in ms. Defaults to style.dimDuration. */
  duration?: number;
  /** Absolute timestamp (ms) for synchronized scheduling. Default: 0. */
  atTime: number;
}

export interface CalloutEffect {
  type: 'callout';
  /** Text content of the callout label. */
  text: string;
  /** CSS selector for the target element the callout points to. */
  selector: string;
  /** Position of the callout relative to the target. Default: 'bottom'. */
  position?: CalloutPosition;
  /** Fade duration in ms. Defaults to style.calloutDuration. */
  duration?: number;
  /** Absolute timestamp (ms) for synchronized scheduling. Default: 0. */
  atTime: number;
}

export type EffectStep = ZoomEffect | DimEffect | CalloutEffect;

// ─── Smooth Scroll Options ───────────────────────────────────────────────────

export interface SmoothScrollOptions {
  /** Horizontal scroll position in pixels. */
  x?: number;
  /** Vertical scroll position in pixels. */
  y?: number;
  /** Scroll duration in ms. Defaults to style.scrollDuration. */
  duration?: number;
}
