/**
 * DemoForge renderer — matrix rendering type definitions.
 *
 * Matrix dimensions: viewport sizes, color schemes (light/dark), locales.
 * Parallel rendering of matrix cells with per-step diff reports.
 */

import type { ViewportConfig } from '@demoforge/core';

// ─── Matrix Configuration ─────────────────────────────────────────────────────

export interface MatrixCellConfig {
  viewport: ViewportConfig;
  theme: 'light' | 'dark';
  locale: string;
}

import type { BrowserSession } from '@demoforge/browser';

export interface MatrixConfig {
  /** Maximum number of parallel renderings. Default: 3. */
  concurrency?: number;
  /** Explicit list of cells to render. If omitted, computes full Cartesian product. */
  cells?: MatrixCellConfig[];
  /** Which cell to use as the baseline for diff comparison. Default: first cell. */
  baselineCellId?: string;
  /** Output formats to produce. Default: ['mp4']. */
  formats?: ('mp4' | 'webm' | 'gif' | 'webp')[];
  /** Whether to apply visual effects (T11_effects) to each cell. Default: true. */
  effects?: boolean;
  /** Per-step screenshot capture for diff reports. Default: true. */
  captureScreenshots?: boolean;
  /** Optional browser factory for creating per-cell browser sessions. Used in tests. */
  createBrowser?: (viewport: ViewportConfig) => BrowserSession;
}

// ─── Matrix Result ─────────────────────────────────────────────────────────────

export interface MatrixCellResult {
  /** Unique cell identifier: `{viewport}-{theme}-{locale}`. */
  cellId: string;
  /** Viewport dimensions for this cell. */
  viewport: ViewportConfig;
  /** Theme: 'light' or 'dark'. */
  theme: 'light' | 'dark';
  /** Locale (e.g., 'en-US', 'ja-JP'). */
  locale: string;
  /** Whether this cell was rendered successfully. */
  success: boolean;
  /** Output file paths produced for this cell. */
  outputPaths: string[];
  /** Warnings produced during rendering. */
  warnings: string[];
  /** Wall-clock time to render this cell in milliseconds. */
  duration: number;
  /** Screenshot buffers captured at each step (for diff reports). */
  stepScreenshots: Buffer[];
}

export interface MatrixRenderResult {
  /** All matrix cells that were rendered. */
  cells: MatrixCellResult[];
  /** Total number of cells in the matrix. */
  totalCells: number;
  /** Number of cells that rendered successfully. */
  successfulCells: number;
  /** Number of cells that failed. */
  failedCells: number;
  /** Total wall-clock time for all rendering. */
  totalDuration: number;
  /** Whether all cells rendered successfully. */
  allSuccess: boolean;
  /** Warnings produced during rendering. */
  warnings: string[];
}

// ─── Diff Report ───────────────────────────────────────────────────────────────

export interface CellDiff {
  /** Cell being compared against baseline. */
  cellId: string;
  /** Pixel-wise difference count. */
  pixelDiff: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Similarity ratio (0-1, 1 = identical). */
  similarity: number;
  /** SSIM score (0-1, 1 = identical structural similarity). */
  ssim: number;
  /** Whether the difference is significant (similarity < 0.95). */
  significant: boolean;
}

export interface StepDiff {
  /** Step index in the demo script. */
  stepIndex: number;
  /** Step type (e.g., 'click', 'fill', 'goto'). */
  stepType: string;
  /** Diffs for each non-baseline cell at this step. */
  cellDiffs: CellDiff[];
  /** Number of cells with significant differences at this step. */
  significantCount: number;
}

export interface DiffReport {
  /** Per-step diff comparisons against the baseline cell. */
  steps: StepDiff[];
  /** Overall summary: total cells compared, significant diffs found. */
  summary: {
    totalCompared: number;
    significantDiffs: number;
    cellsWithSignificantDiffs: string[];
  };
}

export interface MatrixRenderOptions {
  /** Base output directory for all cell outputs. */
  outputDir: string;
  /** Demo script name/flow identifier for output naming. */
  flowName: string;
  /** Matrix configuration. */
  config: MatrixConfig;
  /** Whether to generate a diff report. */
  diffReport?: boolean;
}
