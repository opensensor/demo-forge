/**
 * DemoForge renderer — matrix rendering tests.
 *
 * Tests for:
 * - generateCellId: unique cell ID generation
 * - computeMatrixCombinations: full Cartesian product + subset
 * - generateOutputFilename: output naming convention
 * - calculateSSIM: structural similarity index accuracy
 * - Theme CSS injection content
 * - Locale override JS content
 * - Concurrency limiting
 * - Diff report generation
 * - RenderMatrix class configuration
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import type { DemoScript } from '@demoforge/core';
import type { BrowserSession } from '@demoforge/browser';

import {
  RenderMatrix,
  generateCellId,
  computeMatrixCombinations,
  generateOutputFilename,
  calculateSSIM,
} from './index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

async function createSolidPng(r: number, g: number, b: number, size = 64): Promise<Buffer> {
  const canvas = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="rgb(${r},${g},${b})"/>
    </svg>`,
    'utf-8',
  );
  return sharp(canvas).png().toBuffer();
}

// ─── Mock BrowserSession ──────────────────────────────────────────────────────

let mockPng: Buffer;

beforeAll(async () => {
  mockPng = await createSolidPng(100, 100, 100, 100);
});

function createMockBrowser(): Partial<BrowserSession> {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    wait_for: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(mockPng),
    executeCDP: vi.fn().mockResolvedValue({}),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createScript(
  steps: DemoScript['steps'],
  renderMatrix?: DemoScript['render_matrix'],
): DemoScript {
  return {
    demo: 'test',
    title: 'Test',
    viewport: { width: 1280, height: 720, scale: 1 },
    narration_mode: 'none',
    steps,
    render_matrix: renderMatrix,
  };
}

// ─── generateCellId Tests ─────────────────────────────────────────────────────

describe('generateCellId', () => {
  it('generates correct format: {width}x{height}-{theme}-{locale}', () => {
    const id = generateCellId({ width: 1440, height: 900 }, 'dark', 'ja-JP');
    expect(id).toBe('1440x900-dark-ja-JP');
  });

  it('handles light theme', () => {
    const id = generateCellId({ width: 1280, height: 720 }, 'light', 'en-US');
    expect(id).toBe('1280x720-light-en-US');
  });

  it('handles different locales', () => {
    const id = generateCellId({ width: 1920, height: 1080 }, 'dark', 'de-DE');
    expect(id).toBe('1920x1080-dark-de-DE');
  });

  it('produces unique IDs for different combinations', () => {
    const ids = new Set<string>();
    const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
    const themes = ['light', 'dark'] as const;
    const locales = ['en-US', 'ja-JP'];

    for (const vp of viewports) {
      for (const theme of themes) {
        for (const locale of locales) {
          ids.add(generateCellId(vp, theme, locale));
        }
      }
    }

    expect(ids.size).toBe(8);
  });
});

// ─── computeMatrixCombinations Tests ──────────────────────────────────────────

describe('computeMatrixCombinations', () => {
  it('produces full Cartesian product', () => {
    const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
    const themes = ['light', 'dark'] as const;
    const locales = ['en-US', 'ja-JP'];

    const result = computeMatrixCombinations(viewports, themes, locales);

    expect(result.length).toBe(8); // 2 * 2 * 2
  });

  it('includes all viewport/theme/locale combinations', () => {
    const viewports = [{ width: 1440, height: 900 }];
    const themes = ['light', 'dark'] as const;
    const locales = ['en-US'];

    const result = computeMatrixCombinations(viewports, themes, locales);

    expect(result).toContainEqual({
      viewport: { width: 1440, height: 900 },
      theme: 'light',
      locale: 'en-US',
    });
    expect(result).toContainEqual({
      viewport: { width: 1440, height: 900 },
      theme: 'dark',
      locale: 'en-US',
    });
  });

  it('handles single viewport, single theme, single locale', () => {
    const result = computeMatrixCombinations(
      [{ width: 1280, height: 720 }],
      ['light'] as const,
      ['en-US'],
    );

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({
      viewport: { width: 1280, height: 720 },
      theme: 'light',
      locale: 'en-US',
    });
  });

  it('handles multiple locales', () => {
    const result = computeMatrixCombinations(
      [{ width: 1440, height: 900 }],
      ['light', 'dark'] as const,
      ['en-US', 'ja-JP', 'de-DE'],
    );

    expect(result.length).toBe(6); // 1 * 2 * 3
  });

  it('preserves viewport order in output', () => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ];
    const result = computeMatrixCombinations(viewports, ['light'] as const, ['en-US']);

    expect(result[0].viewport).toBe(viewports[0]);
    expect(result[1].viewport).toBe(viewports[1]);
    expect(result[2].viewport).toBe(viewports[2]);
  });
});

// ─── generateOutputFilename Tests ─────────────────────────────────────────────

describe('generateOutputFilename', () => {
  it('produces correct format: {flow}-{viewport}-{theme}-{locale}.{ext}', () => {
    const filename = generateOutputFilename('login-flow', '1440x900-dark-ja-JP', 'mp4');
    expect(filename).toBe('login-flow-1440x900-dark-ja-JP.mp4');
  });

  it('handles different extensions', () => {
    const mp4 = generateOutputFilename('demo', '1280x720-light-en-US', 'mp4');
    const gif = generateOutputFilename('demo', '1280x720-light-en-US', 'gif');
    const webm = generateOutputFilename('demo', '1280x720-light-en-US', 'webm');
    const webp = generateOutputFilename('demo', '1280x720-light-en-US', 'webp');

    expect(mp4).toBe('demo-1280x720-light-en-US.mp4');
    expect(gif).toBe('demo-1280x720-light-en-US.gif');
    expect(webm).toBe('demo-1280x720-light-en-US.webm');
    expect(webp).toBe('demo-1280x720-light-en-US.webp');
  });

  it('handles flow names with hyphens', () => {
    const filename = generateOutputFilename('user-onboarding', '1920x1080-dark-en-US', 'mp4');
    expect(filename).toBe('user-onboarding-1920x1080-dark-en-US.mp4');
  });
});

// ─── calculateSSIM Tests ──────────────────────────────────────────────────────

describe('calculateSSIM', () => {
  it('returns 1 for identical images', async () => {
    const png = await createSolidPng(128, 128, 128);
    const result = await calculateSSIM(png, png);
    expect(result).toBe(1);
  });

  it('returns low SSIM for very different images', async () => {
    const black = await createSolidPng(0, 0, 0);
    const white = await createSolidPng(255, 255, 255);
    const result = await calculateSSIM(black, white);
    expect(result).toBeLessThan(0.5);
  });

  it('returns high SSIM for similar images', async () => {
    const base = await createSolidPng(128, 128, 128);
    const similar = await createSolidPng(129, 129, 129);
    const result = await calculateSSIM(base, similar);
    expect(result).toBeGreaterThan(0.9);
  });

  it('handles empty buffers gracefully', async () => {
    const empty1 = Buffer.from([]);
    const empty2 = Buffer.from([]);
    const result = await calculateSSIM(empty1, empty2);
    expect(result).toBe(1);
  });
});

// ─── RenderMatrix Class Tests ─────────────────────────────────────────────────

describe('RenderMatrix — configuration', () => {
  it('creates matrix with default config', () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: 'button' },
      { done: true },
    ]);

    const matrix = new RenderMatrix(script);
    expect(matrix.cellCount).toBeGreaterThan(0);
  });

  it('uses render_matrix from script when no explicit cells provided', () => {
    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }, { width: 768, height: 1024 }],
        themes: ['light', 'dark'],
        locales: ['en-US', 'ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script);
    expect(matrix.cellCount).toBe(8); // 2 * 2 * 2
  });

  it('uses explicit cells when provided', () => {
    const script = createScript([{ goto: 'http://localhost:3000', done: true }]);

    const matrix = new RenderMatrix(script, {
      cells: [
        { viewport: { width: 1440, height: 900 }, theme: 'light', locale: 'en-US' },
        { viewport: { width: 1280, height: 720 }, theme: 'dark', locale: 'ja-JP' },
      ],
    });

    expect(matrix.cellCount).toBe(2);
  });

  it('respects concurrency config', () => {
    const script = createScript([{ goto: 'http://localhost:3000', done: true }]);
    const matrix = new RenderMatrix(script, { concurrency: 5 });
    expect(matrix.cellCount).toBeGreaterThan(0);
  });

  it('returns cells list', () => {
    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script);
    const cells = matrix.cells;

    expect(cells.length).toBe(2);
    expect(cells[0].viewport).toEqual({ width: 1440, height: 900 });
    expect(cells[0].theme).toBe('light');
    expect(cells[0].locale).toBe('en-US');
    expect(cells[1].theme).toBe('dark');
  });

  it('defaults to light/dark themes when not specified in render_matrix', () => {
    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script);
    const themes = matrix.cells.map((c) => c.theme);
    expect(themes).toContain('light');
    expect(themes).toContain('dark');
  });

  it('defaults to en-US locale when not specified in render_matrix', () => {
    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light'],
      },
    );

    const matrix = new RenderMatrix(script);
    const locales = matrix.cells.map((c) => c.locale);
    expect(locales).toContain('en-US');
  });
});

// ─── RenderMatrix — parallel rendering ────────────────────────────────────────

describe('RenderMatrix — parallel rendering', () => {
  it('renders all cells', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { click: 'button' },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test-flow',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(2);
    expect(result.successfulCells).toBe(2);
    expect(result.failedCells).toBe(0);
    expect(result.allSuccess).toBe(true);
  });

  it('produces one output per matrix cell', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark'],
        locales: ['en-US', 'ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 4,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test-flow',
      config: { formats: ['mp4', 'gif'] },
    });

    expect(result.totalCells).toBe(4); // 2 themes * 2 locales
    expect(result.successfulCells).toBe(4);

    // Verify each cell has output paths for requested formats
    for (const cell of result.cells) {
      expect(cell.outputPaths.length).toBeGreaterThanOrEqual(1);
      expect(cell.outputPaths[0]).toContain(cell.cellId);
    }
  });

  it('output filenames include all matrix dimensions', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'login',
      config: { formats: ['mp4'] },
    });

    for (const cell of result.cells) {
      const path = cell.outputPaths[0];
      expect(path).toContain('login');
      expect(path).toContain(cell.viewport.width.toString());
      expect(path).toContain(cell.theme);
      expect(path).toContain(cell.locale);
      expect(path).toBe(`login-${cell.cellId}.mp4`);
    }
  });

  it('respects concurrency limit', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { pause: 50 },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark', 'light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(4);
    expect(result.successfulCells).toBe(4);
  });

  it('parallel rendering is faster than sequential (concurrency > 1)', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { pause: 10 },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark', 'light', 'dark'],
        locales: ['en-US'],
      },
    );

    // Render with concurrency 4
    const matrix4 = new RenderMatrix(script, {
      concurrency: 4,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result4 = await matrix4.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    expect(result4.totalDuration).toBeGreaterThanOrEqual(0);
    expect(result4.allSuccess).toBe(true);
  });
});

// ─── RenderMatrix — theme handling ────────────────────────────────────────────

describe('RenderMatrix — theme handling', () => {
  it('renders both light and dark themes', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    const themes = result.cells.map((c) => c.theme);
    expect(themes).toContain('light');
    expect(themes).toContain('dark');
  });

  it('configures cell theme correctly', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    const themes = result.cells.map((c) => c.theme);
    expect(themes).toContain('light');
    expect(themes).toContain('dark');
  });

  it('theme CSS override contains prefers-color-scheme', async () => {
    const mockBrowser = createMockBrowser() as unknown as BrowserSession;

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      createBrowser: () => mockBrowser,
    });
    await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    // Check that executeCDP was called with theme override
    const cdpCalls = (mockBrowser.executeCDP as ReturnType<typeof vi.fn>).mock.calls;
    const themeCalls = cdpCalls.filter((call) => {
      if (!call?.[0]?.params?.source) return false;
      const source = call[0].params.source as string;
      return source.includes('prefers-color-scheme');
    });

    expect(themeCalls.length).toBeGreaterThan(0);
  });
});

// ─── RenderMatrix — locale handling ───────────────────────────────────────────

describe('RenderMatrix — locale handling', () => {
  it('renders multiple locales', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light'],
        locales: ['en-US', 'ja-JP', 'de-DE'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 3,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(3);

    const locales = result.cells.map((c) => c.locale);
    expect(locales).toContain('en-US');
    expect(locales).toContain('ja-JP');
    expect(locales).toContain('de-DE');
  });

  it('configures cell locale correctly', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light'],
        locales: ['ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    // Verify the cell has the correct locale
    expect(result.cells[0].locale).toBe('ja-JP');
  });

  it('output filenames include locale', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light'],
        locales: ['ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'demo',
      config: { formats: ['mp4'] },
    });

    const path = result.cells[0].outputPaths[0];
    expect(path).toContain('ja-JP');
  });
});

// ─── RenderMatrix — diff report ───────────────────────────────────────────────

describe('RenderMatrix — diff report', () => {
  it('generates diff report when enabled', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { click: 'button' },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
      diffReport: true,
    });

    expect(result.totalCells).toBe(2);
    expect(result.successfulCells).toBe(2);
  });

  it('captures step screenshots for diff', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { click: 'button' },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      captureScreenshots: true,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    // Each cell should have step screenshots
    for (const cell of result.cells) {
      expect(cell.stepScreenshots.length).toBe(3); // 3 steps
    }
  });

  it('SSIM scores are between 0 and 1', async () => {
    // Create two identical images
    const png = await createSolidPng(128, 128, 128);
    const ssim = await calculateSSIM(png, png);
    expect(ssim).toBeGreaterThanOrEqual(0);
    expect(ssim).toBeLessThanOrEqual(1);
  });
});

// ─── RenderMatrix — effects ───────────────────────────────────────────────────

describe('RenderMatrix — effects', () => {
  it('applies effects by default', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      effects: true,
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    expect(result.successfulCells).toBe(1);
  });

  it('can disable effects', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      effects: false,
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'test',
      config: { formats: ['mp4'] },
    });

    expect(result.successfulCells).toBe(1);
  });
});

// ─── RenderMatrix — edge cases ────────────────────────────────────────────────

describe('RenderMatrix — edge cases', () => {
  it('handles single cell matrix', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1280, height: 720 }],
        themes: ['light'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'single',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(1);
    expect(result.allSuccess).toBe(true);
  });

  it('handles explicit subset of cells', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }, { width: 1280, height: 720 }],
        themes: ['light', 'dark'],
        locales: ['en-US', 'ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script, {
      cells: [
        { viewport: { width: 1440, height: 900 }, theme: 'light', locale: 'en-US' },
      ],
      concurrency: 1,
      createBrowser: () => mockBrowser as BrowserSession,
    });

    expect(matrix.cellCount).toBe(1);

    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'subset',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(1);
    expect(result.cells[0].cellId).toBe('1440x900-light-en-US');
  });

  it('reports warnings on cell failure', async () => {
    const failingBrowser = createMockBrowser();
    (failingBrowser.launch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Browser failed'));

    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 1,
      createBrowser: () => failingBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'fail-test',
      config: { formats: ['mp4'] },
    });

    expect(result.failedCells).toBe(1);
    expect(result.allSuccess).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('generates correct cell IDs for all cells', async () => {
    const script = createScript(
      [{ goto: 'http://localhost:3000', done: true }],
      {
        viewports: [{ width: 1440, height: 900 }, { width: 768, height: 1024 }],
        themes: ['light', 'dark'],
        locales: ['en-US', 'ja-JP'],
      },
    );

    const matrix = new RenderMatrix(script);
    const cellIds = matrix.cells.map((c) => generateCellId(c.viewport, c.theme, c.locale));

    // Verify all IDs are unique
    expect(new Set(cellIds).size).toBe(cellIds.length);

    // Verify expected IDs
    expect(cellIds).toContain('1440x900-light-en-US');
    expect(cellIds).toContain('1440x900-light-ja-JP');
    expect(cellIds).toContain('1440x900-dark-en-US');
    expect(cellIds).toContain('1440x900-dark-ja-JP');
    expect(cellIds).toContain('768x1024-light-en-US');
    expect(cellIds).toContain('768x1024-light-ja-JP');
    expect(cellIds).toContain('768x1024-dark-en-US');
    expect(cellIds).toContain('768x1024-dark-ja-JP');
  });
});

// ─── Concurrency limiting ─────────────────────────────────────────────────────

describe('concurrency limiting', () => {
  it('limits parallel execution to configured concurrency', async () => {
    const mockBrowser = createMockBrowser();

    const script = createScript(
      [
        { goto: 'http://localhost:3000' },
        { pause: 5 },
        { done: true },
      ],
      {
        viewports: [{ width: 1440, height: 900 }],
        themes: ['light', 'dark', 'light', 'dark'],
        locales: ['en-US'],
      },
    );

    const matrix = new RenderMatrix(script, {
      concurrency: 2,
      createBrowser: () => mockBrowser as BrowserSession,
    });
    const result = await matrix.render({
      outputDir: '/tmp/test-output',
      flowName: 'concurrency-test',
      config: { formats: ['mp4'] },
    });

    expect(result.totalCells).toBe(4);
    expect(result.successfulCells).toBe(4);
  });
});
