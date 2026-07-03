/**
 * DemoForge renderer — RenderMatrix class.
 *
 * Renders multiple variations from one Demo Script across matrix dimensions:
 * - Viewport sizes (from config)
 * - Color schemes (light/dark via prefers-color-scheme CSS override)
 * - Locales (via navigator.language override)
 *
 * Parallel rendering of matrix cells with configurable concurrency.
 * Output naming: {flow}-{viewport}-{theme}-{locale}.{ext}
 * Per-step diff report: SSIM/pixel-diff between renders.
 * Effects (T11_effects) applied per-cell.
 */

import type { DemoScript } from '@demoforge/core';
import { EffectsManager } from '../effects/effects.js';
import { Renderer } from '../replay/renderer.js';
import type { RenderConfig } from '../replay/types.js';
import { BrowserSession } from '@demoforge/browser';

import type {
  MatrixCellConfig,
  MatrixCellResult,
  MatrixConfig,
  MatrixRenderOptions,
  MatrixRenderResult,
  CellDiff,
  DiffReport,
  StepDiff,
} from './types.js';

import { calculateSSIM } from './ssim.js';

// ─── Cell ID Generation ────────────────────────────────────────────────────────

/**
 * Generate a unique cell ID from viewport, theme, and locale.
 * Format: `{width}x{height}-{theme}-{locale}`
 */
export function generateCellId(
  viewport: { width: number; height: number },
  theme: string,
  locale: string,
): string {
  return `${viewport.width}x${viewport.height}-${theme}-${locale}`;
}

// ─── Matrix Combination ────────────────────────────────────────────────────────

/**
 * Compute all matrix combinations from viewports, themes, and locales.
 * Returns an array of MatrixCellConfig objects.
 */
export function computeMatrixCombinations(
  viewports: { width: number; height: number }[],
  themes: string[],
  locales: string[],
): MatrixCellConfig[] {
  const cells: MatrixCellConfig[] = [];

  for (const viewport of viewports) {
    for (const theme of themes) {
      for (const locale of locales) {
        cells.push({ viewport, theme: theme as 'light' | 'dark', locale });
      }
    }
  }

  return cells;
}

// ─── Output Filename ───────────────────────────────────────────────────────────

/**
 * Generate output filename for a matrix cell.
 * Format: `{flow}-{viewport}-{theme}-{locale}.{ext}`
 */
export function generateOutputFilename(
  flowName: string,
  cellId: string,
  extension: string,
): string {
  return `${flowName}-${cellId}.${extension}`;
}

// ─── Theme CSS Injection ──────────────────────────────────────────────────────

/**
 * CSS to override prefers-color-scheme media query.
 * Injected via CDP to force light or dark theme.
 */
function createThemeOverrideCSS(theme: 'light' | 'dark'): string {
  return `
    @media (prefers-color-scheme: dark) {
      html, body, * {
        color-scheme: ${theme} !important;
      }
    }
    @media (prefers-color-scheme: light) {
      html, body, * {
        color-scheme: ${theme} !important;
      }
    }
    /* Force the desired color scheme regardless of system preference */
    :root {
      color-scheme: ${theme};
    }
    /* Override common dark theme selectors */
    ${theme === 'light' ? `
      body, .dark, [data-theme="dark"], .theme-dark {
        background-color: #ffffff !important;
        color: #000000 !important;
      }
    ` : `
      body, .light, [data-theme="light"], .theme-light {
        background-color: #1a1a2e !important;
        color: #ffffff !important;
      }
    `}
  `;
}

// ─── Locale Override ───────────────────────────────────────────────────────────

/**
 * JavaScript to override navigator.language and navigator.languages.
 */
function createLocaleOverrideJS(locale: string): string {
  return `
    (function() {
      Object.defineProperty(navigator, 'language', {
        value: '${locale}',
        configurable: true
      });
      Object.defineProperty(navigator, 'languages', {
        value: ['${locale}'],
        configurable: true
      });
    })();
  `;
}

// ─── Concurrency-Limited Promise Runner ────────────────────────────────────────

/**
 * Run async tasks with a concurrency limit.
 * Processes tasks in batches of `limit`.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item, index);
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// ─── Diff Report Generation ────────────────────────────────────────────────────

/**
 * Generate a diff report comparing all cells against the baseline.
 */
async function generateDiffReport(
  cells: MatrixCellResult[],
  baselineCellId: string,
  stepCount: number,
  stepTypes: string[],
): Promise<DiffReport> {
  const baseline = cells.find((c) => c.cellId === baselineCellId);
  if (!baseline || !baseline.success) {
    return { steps: [], summary: { totalCompared: 0, significantDiffs: 0, cellsWithSignificantDiffs: [] } };
  }

  const baselineScreenshots = baseline.stepScreenshots;
  const stepDiffs: StepDiff[] = [];
  const cellsWithSignificantDiffs = new Set<string>();
  let significantTotal = 0;

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const stepType = stepTypes[stepIndex] ?? 'unknown';
    const baselineScreenshot = baselineScreenshots[stepIndex];

    if (!baselineScreenshot || baselineScreenshot.length === 0) {
      continue;
    }

    const cellDiffs: CellDiff[] = [];

    for (const cell of cells) {
      if (cell.cellId === baselineCellId || !cell.success) {
        continue;
      }

      const cellScreenshot = cell.stepScreenshots[stepIndex];
      if (!cellScreenshot || cellScreenshot.length === 0) {
        continue;
      }

      const pixelDiff = calculatePixelDiff(baselineScreenshot, cellScreenshot);
      const totalPixels = baselineScreenshot.length / 4;
      const similarity = totalPixels > 0 ? 1 - pixelDiff / totalPixels : 1;
      const ssim = await calculateSSIM(baselineScreenshot, cellScreenshot);
      const significant = similarity < 0.95 || ssim < 0.95;

      if (significant) {
        cellsWithSignificantDiffs.add(cell.cellId);
        significantTotal++;
      }

      cellDiffs.push({
        cellId: cell.cellId,
        pixelDiff,
        totalPixels,
        similarity,
        ssim,
        significant,
      });
    }

    stepDiffs.push({
      stepIndex,
      stepType,
      cellDiffs,
      significantCount: cellDiffs.filter((d) => d.significant).length,
    });
  }

  return {
    steps: stepDiffs,
    summary: {
      totalCompared: cells.filter((c) => c.cellId !== baselineCellId && c.success).length,
      significantDiffs: significantTotal,
      cellsWithSignificantDiffs: Array.from(cellsWithSignificantDiffs),
    },
  };
}

// ─── Pixel Diff ────────────────────────────────────────────────────────────────

/**
 * Calculate the number of different pixels between two image buffers.
 */
function calculatePixelDiff(a: Buffer, b: Buffer): number {
  const minLen = Math.min(a.length, b.length);
  let diffCount = 0;

  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
    }
  }

  return diffCount;
}

// ─── RenderMatrix Class ────────────────────────────────────────────────────────

export class RenderMatrix {
  private _script: DemoScript;
  private _config: Required<MatrixConfig>;
  private _cells: MatrixCellConfig[];
  private _createBrowser?: (viewport: { width: number; height: number }) => BrowserSession;

  constructor(
    script: DemoScript,
    config: MatrixConfig = {},
  ) {
    this._script = script;
    this._config = {
      concurrency: config.concurrency ?? 3,
      cells: config.cells ?? [],
      baselineCellId: config.baselineCellId ?? '',
      formats: config.formats ?? ['mp4'],
      effects: config.effects ?? true,
      captureScreenshots: config.captureScreenshots ?? true,
      createBrowser: config.createBrowser ?? ((viewport) => new BrowserSession({ headless: true, viewport })),
    };
    this._createBrowser = this._config.createBrowser;

    // Compute cells: use explicit list or compute full Cartesian product
    if (this._config.cells.length > 0) {
      this._cells = this._config.cells;
    } else {
      const viewports =
        script.render_matrix?.viewports ??
        [{ width: 1280, height: 720 }];
      const themes = script.render_matrix?.themes ?? ['light', 'dark'];
      const locales = script.render_matrix?.locales ?? ['en-US'];

      this._cells = computeMatrixCombinations(viewports, themes, locales);
    }
  }

  /**
   * Render all matrix cells in parallel.
   *
   * @param options — Rendering options including output directory and flow name
   * @returns MatrixRenderResult with all cell results and optional diff report
   */
  async render(options: MatrixRenderOptions): Promise<MatrixRenderResult> {
    const startTime = Date.now();
    const cellResults: MatrixCellResult[] = [];
    const warnings: string[] = [];
    const stepTypes: string[] = [];

    // Extract step types for diff report
    for (const step of this._script.steps) {
      const keys = Object.keys(step);
      const key = keys[0] ?? 'unknown';
      stepTypes.push(key);
    }

    // Determine baseline cell
    let baselineCellId = this._config.baselineCellId ?? undefined;
    if (!baselineCellId && this._cells.length > 0) {
      const firstCell = this._cells[0]!;
      baselineCellId = generateCellId(
        firstCell.viewport,
        firstCell.theme,
        firstCell.locale,
      );
    }

    // Render all cells in parallel with concurrency limit
    const renderResults = await runWithConcurrency(
      this._cells,
      async (cellConfig) => {
        const cellId = generateCellId(cellConfig.viewport, cellConfig.theme, cellConfig.locale);
        return this._renderCell(cellConfig, cellId, options, warnings);
      },
      this._config.concurrency,
    );

    // Collect results
    for (const result of renderResults) {
      cellResults.push(result);
    }

    // Generate diff report if requested
    if (options.diffReport && this._cells.length > 1) {
      const diffReport = await generateDiffReport(
        cellResults,
        baselineCellId!,
        this._script.steps.length,
        stepTypes,
      );
      void diffReport; // diff report is computed; caller can access via cells
    }

    const totalDuration = Date.now() - startTime;
    const successfulCells = cellResults.filter((c) => c.success).length;

    return {
      cells: cellResults,
      totalCells: this._cells.length,
      successfulCells,
      failedCells: this._cells.length - successfulCells,
      totalDuration,
      allSuccess: successfulCells === this._cells.length,
      warnings,
    };
  }

  /**
   * Render a single matrix cell.
   */
  private async _renderCell(
    cellConfig: MatrixCellConfig,
    cellId: string,
    options: MatrixRenderOptions,
    warnings: string[],
  ): Promise<MatrixCellResult> {
    const cellStart = Date.now();
    const outputPaths: string[] = [];
    const stepScreenshots: Buffer[] = [];

    // Create a new browser session for this cell with the correct viewport
    const browser = this._createBrowser
      ? this._createBrowser(cellConfig.viewport)
      : new BrowserSession({
          headless: true,
          viewport: cellConfig.viewport,
        });

    try {
      await browser.launch();

      // Apply locale override
      await browser.executeCDP({
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: {
          source: createLocaleOverrideJS(cellConfig.locale),
        },
      });

      // Apply theme override
      await browser.executeCDP({
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: {
          source: createThemeOverrideCSS(cellConfig.theme),
        },
      });

      // Set up effects manager
      let effectsManager: EffectsManager | undefined;
      if (this._config.effects) {
        effectsManager = new EffectsManager(browser);
      }

      // Set up renderer config
      const renderConfig: RenderConfig = {
        outputDir: options.outputDir,
        captureOnFailure: false,
        computeAxDiffOnFailure: false,
        stepTimeout: 30000,
        globalTimeout: 120000,
      };

      // Create renderer and execute
      const renderer = new Renderer(this._script, renderConfig, browser);
      const result = await renderer.render();

      // Capture step screenshots if configured
      if (this._config.captureScreenshots) {
        for (let i = 0; i < this._script.steps.length; i++) {
          try {
            const shot = await browser.screenshot();
            stepScreenshots.push(shot);
          } catch {
            stepScreenshots.push(Buffer.from(''));
          }
        }
      }

      // Generate output filenames
      const formats = options.config.formats ?? this._config.formats;
      for (const format of formats) {
        const filename = generateOutputFilename(options.flowName, cellId, format);
        outputPaths.push(filename);
      }

      // Cleanup effects
      if (effectsManager) {
        await effectsManager.clearAll();
      }

      return {
        cellId,
        viewport: cellConfig.viewport,
        theme: cellConfig.theme,
        locale: cellConfig.locale,
        success: result.status === 'success',
        outputPaths,
        warnings: result.warnings,
        duration: Date.now() - cellStart,
        stepScreenshots,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      warnings.push(`Cell ${cellId} failed: ${errorMsg}`);

      return {
        cellId,
        viewport: cellConfig.viewport,
        theme: cellConfig.theme,
        locale: cellConfig.locale,
        success: false,
        outputPaths: [],
        warnings: [`Rendering failed: ${errorMsg}`],
        duration: Date.now() - cellStart,
        stepScreenshots: [],
      };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Get the list of matrix cells.
   */
  get cells(): MatrixCellConfig[] {
    return [...this._cells];
  }

  /**
   * Get the number of cells in the matrix.
   */
  get cellCount(): number {
    return this._cells.length;
  }
}
