/**
 * DemoForge renderer — script replay engine tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DemoScript } from '@demoforge/core';

import type { BrowserSession } from '@demoforge/browser';

import { Renderer } from './renderer.js';
import { stabilityDetect } from './stability.js';
import { accessibilityDiff } from './accessibility.js';

// ─── Mock BrowserSession ─────────────────────────────────────────────────────

interface MockBrowserSession {
  launch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  hover: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  wait_for: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
}

function createMockBrowser(): MockBrowserSession & BrowserSession {
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
    screenshot: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
  } as unknown as MockBrowserSession & BrowserSession;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createScript(steps: DemoScript['steps']): DemoScript {
  return {
    demo: 'test',
    title: 'Test',
    viewport: { width: 1280, height: 720, scale: 1 },
    narration_mode: 'none',
    steps,
  };
}

// ─── Step Execution Tests ────────────────────────────────────────────────────

describe('Renderer — step execution', () => {
  let mock: MockBrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('executes goto step', async () => {
    const script = createScript([{ goto: 'http://localhost:3000' }]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.stepCount).toBe(1);
    expect(mock.goto).toHaveBeenCalledWith('http://localhost:3000', 'load');
  });

  it('executes goto step with settle policy', async () => {
    const script = createScript([{ goto: 'http://localhost:3000', settle: 'networkidle' }]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.goto).toHaveBeenCalledWith('http://localhost:3000', 'networkidle');
  });

  it('executes click step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.click).toHaveBeenCalledWith({ role: 'button', name: 'Submit' });
  });

  it('executes hover step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { hover: { css: '.tooltip' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.hover).toHaveBeenCalledWith({ css: '.tooltip' });
  });

  it('executes fill step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { fill: { target: { role: 'textbox', name: 'Email' }, value: 'user@example.com' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.fill).toHaveBeenCalledWith({ role: 'textbox', name: 'Email' }, 'user@example.com');
  });

  it('executes select step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { select: { target: { role: 'combobox', name: 'Country' }, value: 'US' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.select).toHaveBeenCalledWith({ role: 'combobox', name: 'Country' }, 'US');
  });

  it('executes press step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { press: { key: 'Enter' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.press).toHaveBeenCalledWith('Enter');
  });

  it('executes wait_for text step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { wait_for: { text: 'Dashboard', timeout: 5000 } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.wait_for).toHaveBeenCalledWith({ text: 'Dashboard', timeout: 5000 });
  });

  it('executes wait_for selector step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { wait_for: { selector: { role: 'heading', name: 'Dashboard' }, timeout: 5000 } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.wait_for).toHaveBeenCalledWith({
      selector: { role: 'heading', name: 'Dashboard' },
      timeout: 5000,
    });
  });

  it('executes narrate step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { narrate: 'The user lands on the dashboard.' },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.steps[1].status).toBe('timing');
  });

  it('executes pause step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { pause: 1000 },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.steps[1].status).toBe('timing');
  });

  it('executes screenshot step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { screenshot: {} },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(mock.screenshot).toHaveBeenCalled();
  });

  it('executes mark_flow_start step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { mark_flow_start: { name: 'login' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.steps[1].stepType).toBe('mark_flow_start');
  });

  it('executes mark_flow_end step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { mark_flow_end: { name: 'login' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.steps[1].stepType).toBe('mark_flow_end');
  });

  it('stops rendering at done step', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { done: true },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.stepCount).toBe(2);
    expect(mock.click).not.toHaveBeenCalled();
  });

  it('executes multiple steps in sequence', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { fill: { target: { role: 'textbox', name: 'Email' }, value: 'a@b.com' } },
      { fill: { target: { role: 'textbox', name: 'Password' }, value: 'secret' } },
      { click: { role: 'button', name: 'Sign In' } },
      { wait_for: { text: 'Welcome' } },
      { narrate: 'Login complete.' },
      { done: true },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.stepCount).toBe(7);
    expect(mock.fill).toHaveBeenCalledTimes(2);
    expect(mock.click).toHaveBeenCalled();
    expect(mock.wait_for).toHaveBeenCalled();
  });
});

// ─── Timeout Tests ───────────────────────────────────────────────────────────

describe('Renderer — timeout policies', () => {
  let mock: MockBrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('per-step timeout fires after configured duration', async () => {
    mock.click.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
    );

    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, { stepTimeout: 100 }, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('timeout');
    expect(result.steps[1].status).toBe('timeout');
  });

  it('global timeout fires after configured duration', async () => {
    mock.goto.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
    );
    mock.click.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 400)),
    );

    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, { globalTimeout: 500 }, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('timeout');
  });

  it('per-step timeout includes timeoutMs in result', async () => {
    mock.click.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 500)),
    );

    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, { stepTimeout: 100 }, mock as unknown as BrowserSession);
    const result = await renderer.render();

    const timeoutStep = result.steps[1] as { status: 'timeout'; timeoutMs: number };
    expect(timeoutStep.status).toBe('timeout');
    expect(timeoutStep.timeoutMs).toBe(100);
  });
});

// ─── Failure Output Tests ────────────────────────────────────────────────────

describe('Renderer — failure output', () => {
  let mock: MockBrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('step failure is recorded with error message', async () => {
    mock.click.mockRejectedValue(new Error('Element not found'));

    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('failure');
    expect(result.steps[1].status).toBe('failure');
    expect((result.steps[1] as { error: string }).error).toBe('Element not found');
  });

  it('renderer stops on step failure', async () => {
    mock.click.mockRejectedValue(new Error('Not found'));

    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
      { click: { role: 'button', name: 'Next' } },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('failure');
    expect(result.stepCount).toBe(2);
    expect(mock.click).toHaveBeenCalledTimes(1);
  });
});

// ─── CSP Detection Tests ─────────────────────────────────────────────────────

describe('Renderer — CSP detection', () => {
  let mock: MockBrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('cspDetected is false by default', () => {
    const script = createScript([{ goto: 'http://localhost:3000' }]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    expect(renderer.cspDetected).toBe(false);
  });
});

// ─── Stability Detection Tests ───────────────────────────────────────────────

describe('Renderer — stability detection', () => {
  it('identifies most stable render', () => {
    const screenshots = [
      Buffer.from('render1'),
      Buffer.from('render1'),
      Buffer.from('render2'),
    ];

    const results: Array<{
      status: 'success' | 'failure' | 'timeout';
      totalDuration: number;
      stepCount: number;
      warnings: string[];
      steps: Array<{ status: string }>;
    }> = screenshots.map(() => ({
      status: 'success',
      totalDuration: 100,
      stepCount: 1,
      warnings: [],
      steps: [{ status: 'success' }],
    }));

    const stableResult = stabilityDetect(results, screenshots);

    expect(stableResult.stableIndex).toBe(0);
  });

  it('handles all different renders', () => {
    const screenshots = [
      Buffer.from('render1'),
      Buffer.from('render2'),
      Buffer.from('render3'),
    ];

    const results: Array<{
      status: 'success' | 'failure' | 'timeout';
      totalDuration: number;
      stepCount: number;
      warnings: string[];
      steps: Array<{ status: string }>;
    }> = screenshots.map(() => ({
      status: 'success',
      totalDuration: 100,
      stepCount: 1,
      warnings: [],
      steps: [{ status: 'success' }],
    }));

    const stableResult = stabilityDetect(results, screenshots);

    expect(stableResult.stableIndex).toBe(0);
  });

  it('handles all same renders', () => {
    const screenshot = Buffer.from('identical');
    const screenshots = [screenshot, screenshot, screenshot];

    const results: Array<{
      status: 'success' | 'failure' | 'timeout';
      totalDuration: number;
      stepCount: number;
      warnings: string[];
      steps: Array<{ status: string }>;
    }> = screenshots.map(() => ({
      status: 'success',
      totalDuration: 100,
      stepCount: 1,
      warnings: [],
      steps: [{ status: 'success' }],
    }));

    const stableResult = stabilityDetect(results, screenshots);

    expect(stableResult.stableIndex).toBe(0);
  });

  it('handles empty results', () => {
    const stableResult = stabilityDetect([], []);
    expect(stableResult.stableIndex).toBe(0);
    expect(stableResult.allResults).toEqual([]);
  });

  it('handles single render', () => {
    const result = {
      status: 'success' as const,
      totalDuration: 100,
      stepCount: 1,
      warnings: [],
      steps: [{ status: 'success' }],
    };
    const screenshots = [Buffer.from('render')];

    const stableResult = stabilityDetect([result], screenshots);
    expect(stableResult.stableIndex).toBe(0);
    expect(stableResult.stableResult).toBe(result);
  });
});

// ─── Accessibility Diff Tests ────────────────────────────────────────────────

describe('Renderer — accessibility diff', () => {
  it('diffs two AX snapshots', () => {
    const before = 'body > main > h1: Dashboard';
    const after = 'body > main > h1: Welcome';

    const diff = accessibilityDiff(before, after);

    expect(diff).toContain('body > main > h1: Dashboard');
    expect(diff).toContain('body > main > h1: Welcome');
    expect(diff).toContain('---');
    expect(diff).toContain('+++');
  });

  it('returns empty diff when snapshots are identical', () => {
    const snapshot = 'body > main > h1: Dashboard';
    const diff = accessibilityDiff(snapshot, snapshot);
    expect(diff).toBe('');
  });
});

// ─── Full Render Lifecycle Test ──────────────────────────────────────────────

describe('Renderer — full render lifecycle', () => {
  let mock: MockBrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('produces a complete render result', async () => {
    const script = createScript([
      { goto: 'http://localhost:3000' },
      { click: { role: 'button', name: 'Submit' } },
      { wait_for: { text: 'Success' } },
      { narrate: 'Form submitted.' },
      { done: true },
    ]);
    const renderer = new Renderer(script, undefined, mock as unknown as BrowserSession);
    const result = await renderer.render();

    expect(result.status).toBe('success');
    expect(result.stepCount).toBe(5);
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    expect(result.steps).toHaveLength(5);
    expect(result.steps[0].status).toBe('success');
    expect(result.steps[0].stepType).toBe('goto');
    expect(result.steps[3].status).toBe('timing');
    expect(result.steps[3].stepType).toBe('narrate');
  });
});
