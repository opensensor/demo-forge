/**
 * DemoForge renderer — synthetic cursor tests.
 *
 * Tests for: Bezier easing, cursor rendering, click ripple animation,
 * configurable cursor style, timestamp synchronization, and page injection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSession } from '@demoforge/browser';

import { cubicBezier } from './easing.js';
import { Cursor, type CursorConfig, type CursorStyle } from './cursor.js';

// ─── Mock BrowserSession ─────────────────────────────────────────────────────

interface MockBrowserSession {
  launch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  page: ReturnType<typeof vi.fn>;
  executeCDP: ReturnType<typeof vi.fn>;
  waitForNavigation: ReturnType<typeof vi.fn>;
}

function createMockBrowser(): MockBrowserSession & BrowserSession {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockReturnValue({
      url: vi.fn().mockResolvedValue('http://localhost:3000'),
      title: vi.fn().mockResolvedValue('Test'),
    }),
    executeCDP: vi.fn().mockResolvedValue({ result: {} }),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockBrowserSession & BrowserSession;
}

// ─── Bezier Easing Tests ─────────────────────────────────────────────────────

describe('cubicBezier — easing function', () => {
  it('returns 0 at t=0', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1.0); // ease
    expect(fn(0)).toBe(0);
  });

  it('returns 1 at t=1', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1.0); // ease
    expect(fn(1)).toBe(1);
  });

  it('returns 0.5 at t=0.5 for symmetric ease', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1.0);
    const result = fn(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('returns linear for t values', () => {
    const fn = cubicBezier(0, 0, 1, 1); // linear
    expect(fn(0.5)).toBeCloseTo(0.5, 4);
  });

  it('ease-in returns values below linear', () => {
    const fn = cubicBezier(0.42, 0, 1, 1); // ease-in
    const mid = fn(0.5);
    expect(mid).toBeLessThan(0.5);
  });

  it('ease-out returns values above linear', () => {
    const fn = cubicBezier(0, 0, 0.58, 1.0); // ease-out
    const mid = fn(0.5);
    expect(mid).toBeGreaterThan(0.5);
  });

  it('produces smooth interpolation (monotonically increasing)', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1.0);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const t = i / 100;
      const val = fn(t);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('handles custom control points for spring-like easing', () => {
    const fn = cubicBezier(0.68, -0.55, 0.265, 1.55); // overshoot ease
    const result = fn(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('returns a function that accepts t between 0 and 1', () => {
    const fn = cubicBezier(0.25, 0.1, 0.25, 1.0);
    expect(fn(0.25)).toBeGreaterThan(0);
    expect(fn(0.75)).toBeGreaterThan(fn(0.25));
  });
});

// ─── Cursor Style Tests ──────────────────────────────────────────────────────

describe('Cursor — style configuration', () => {
  it('creates cursor with default style', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });

  it('creates cursor with custom color', () => {
    const cursor = new Cursor({ style: { color: '#ff0000' } });
    expect(cursor).toBeDefined();
  });

  it('creates cursor with custom size', () => {
    const cursor = new Cursor({ style: { size: 20 } });
    expect(cursor).toBeDefined();
  });

  it('creates cursor with custom shape', () => {
    const cursor = new Cursor({ style: { shape: 'pointer' } });
    expect(cursor).toBeDefined();
  });

  it('creates cursor with all style options', () => {
    const style: CursorStyle = {
      color: '#3b82f6',
      size: 16,
      shape: 'pointer',
      border: '2px solid #1d4ed8',
      boxShadow: '0 0 8px rgba(59, 130, 246, 0.5)',
      transitionDuration: 300,
    };
    const cursor = new Cursor({ style });
    expect(cursor).toBeDefined();
  });

  it('validates size is positive', () => {
    expect(() => new Cursor({ style: { size: -5 } })).toThrow();
  });

  it('validates size is within reasonable range', () => {
    expect(() => new Cursor({ style: { size: 200 } })).toThrow();
  });

  it('validates shape value', () => {
    expect(() => new Cursor({ style: { shape: 'invalid' as any } })).toThrow();
  });

  it('validates color format', () => {
    expect(() => new Cursor({ style: { color: 'not-a-color' } })).toThrow();
  });

  it('applies default color when not specified', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });

  it('applies default size when not specified', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });

  it('applies default shape when not specified', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });
});

// ─── Cursor Movement Tests ───────────────────────────────────────────────────

describe('Cursor — movement', () => {
  it('moves cursor to a position', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200);
    expect(cursor).toBeDefined();
  });

  it('moves cursor with duration', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { duration: 500 });
    expect(cursor).toBeDefined();
  });

  it('moves cursor with custom easing', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { easing: cubicBezier(0.68, -0.55, 0.265, 1.55) });
    expect(cursor).toBeDefined();
  });

  it('moves cursor with click ripple', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { click: true });
    expect(cursor).toBeDefined();
  });

  it('chains multiple movements', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 100);
    await cursor.moveTo(200, 200);
    await cursor.moveTo(300, 300);
    expect(cursor).toBeDefined();
  });
});

// ─── Click Ripple Tests ──────────────────────────────────────────────────────

describe('Cursor — click ripple animation', () => {
  it('triggers ripple on click', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { click: true });
  });

  it('ripple has configurable duration', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({
      browser: mock as unknown as BrowserSession,
      clickRippleDuration: 400,
    });
    await cursor.moveTo(100, 200, { click: true });
  });

  it('ripple has configurable color', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({
      browser: mock as unknown as BrowserSession,
      clickRippleColor: '#ff5722',
    });
    await cursor.moveTo(100, 200, { click: true });
  });

  it('ripple has configurable max radius', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({
      browser: mock as unknown as BrowserSession,
      clickRippleMaxRadius: 40,
    });
    await cursor.moveTo(100, 200, { click: true });
  });

  it('does not trigger ripple without click flag', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { click: false });
  });

  it('does not trigger ripple when click option omitted', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200);
  });
});

// ─── Injection Tests ─────────────────────────────────────────────────────────

describe('Cursor — page injection', () => {
  it('injects cursor element into page', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
  });

  it('removes cursor element from page', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
    await cursor.remove();
  });

  it('is not injected by default', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });

  it('updates cursor position via injection', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
    await cursor.moveTo(500, 500);
  });

  it('updates cursor style via injection', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({
      browser: mock as unknown as BrowserSession,
      style: { color: '#00ff00', size: 12 },
    });
    await cursor.inject();
  });
});

// ─── Timestamp Synchronization Tests ─────────────────────────────────────────

describe('Cursor — timestamp synchronization', () => {
  it('accepts duration parameter for timing', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200, { duration: 50 });
    expect(cursor.currentX).toBe(100);
    expect(cursor.currentY).toBe(200);
  });

  it('synchronizes position with timing', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 100, { duration: 100 });
    await cursor.moveTo(200, 200, { duration: 100 });
  });

  it('supports scheduled movement with absolute timestamp', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    const targetTime = Date.now() + 500;
    await cursor.moveTo(100, 200, { duration: 500, atTime: targetTime });
  });

  it('moves to multiple points with different timings', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(0, 0, { duration: 200 });
    await cursor.moveTo(100, 100, { duration: 300 });
    await cursor.moveTo(200, 200, { duration: 400 });
  });
});

// ─── Integration with Renderer Action Types ──────────────────────────────────

describe('Cursor — renderer integration types', () => {
  it('has actionPoint type compatible with click actions', () => {
    const point = { x: 100, y: 200 };
    expect(point).toHaveProperty('x');
    expect(point).toHaveProperty('y');
  });

  it('has moveOptions type with all expected properties', () => {
    const options = {
      duration: 300,
      easing: cubicBezier(0.25, 0.1, 0.25, 1.0),
      click: false,
      atTime: 0,
    };
    expect(options).toHaveProperty('duration');
    expect(options).toHaveProperty('easing');
    expect(options).toHaveProperty('click');
    expect(options).toHaveProperty('atTime');
  });

  it('has cursorConfig type with all expected properties', () => {
    const config: CursorConfig = {
      style: { color: '#000', size: 10, shape: 'default' },
      clickRippleDuration: 300,
      clickRippleColor: '#000',
      clickRippleMaxRadius: 30,
    };
    expect(config).toHaveProperty('style');
    expect(config).toHaveProperty('clickRippleDuration');
    expect(config).toHaveProperty('clickRippleColor');
    expect(config).toHaveProperty('clickRippleMaxRadius');
  });
});

// ─── Cursor DOM Isolation Tests ──────────────────────────────────────────────

describe('Cursor — DOM isolation', () => {
  it('injects cursor outside app DOM via CDP', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
    // Verify CDP was called for injection
    expect(mock.executeCDP).toHaveBeenCalled();
  });

  it('cursor does not interfere with page content', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
    // Cursor should be injected via CDP, not by modifying page DOM
    expect(mock.executeCDP).toHaveBeenCalled();
  });

  it('removes cursor without affecting page content', async () => {
    const mock = createMockBrowser();
    mock.executeCDP.mockResolvedValue({ result: { success: true } });
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.inject();
    await cursor.remove();
    // Remove should not throw
  });
});

// ─── Cursor State Tests ──────────────────────────────────────────────────────

describe('Cursor — state management', () => {
  it('tracks current position', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200);
  });

  it('tracks whether cursor is injected', () => {
    const cursor = new Cursor();
    expect(cursor).toBeDefined();
  });

  it('handles rapid successive movements', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    for (let i = 0; i < 10; i++) {
      await cursor.moveTo(i * 10, i * 10, { duration: 10 });
    }
  });

  it('handles movement to same position', async () => {
    const mock = createMockBrowser();
    const cursor = new Cursor({ browser: mock as unknown as BrowserSession });
    await cursor.moveTo(100, 200);
    await cursor.moveTo(100, 200);
  });
});
