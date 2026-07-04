/**
 * DemoForge renderer — virtual time controller tests.
 *
 * Tests for VirtualTimeController: CDP virtual time injection for stabilizing
 * animated UIs. Covers factor configuration, start/stop lifecycle, fallback
 * to real time, and per-step application.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSession } from '@demoforge/browser';

import { VirtualTimeController } from './controller.js';

// ─── Mock BrowserSession ─────────────────────────────────────────────────────

function createMockBrowserSession(): MockBrowserSession {
  return {
    setVirtualTime: vi.fn().mockResolvedValue(undefined),
    resetVirtualTime: vi.fn().mockResolvedValue(undefined),
    executeCDP: vi.fn().mockResolvedValue({ result: {} }),
    launch: vi.fn().mockResolvedValue({} as unknown as BrowserSession),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    wait_for: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('mock')),
    isRunning: false,
    screencastActive: false,
  };
}

interface MockBrowserSession extends Omit<BrowserSession, 'launch' | 'close'> {
  setVirtualTime: ReturnType<typeof vi.fn>;
  resetVirtualTime: ReturnType<typeof vi.fn>;
  executeCDP: ReturnType<typeof vi.fn>;
  launch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  hover: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  scroll: ReturnType<typeof vi.fn>;
  wait_for: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('VirtualTimeController', () => {
  let mockBrowser: MockBrowserSession;

  beforeEach(() => {
    mockBrowser = createMockBrowserSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates controller with default factor of 1', () => {
      const controller = new VirtualTimeController(mockBrowser);
      expect(controller['factor']).toBe(1);
      expect(controller['enabled']).toBe(false);
    });

    it('creates controller with custom factor', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      expect(controller['factor']).toBe(0.5);
    });

    it('creates controller with maxVirtualTime config', () => {
      const controller = new VirtualTimeController(mockBrowser, {
        factor: 0.5,
        maxVirtualTime: 60000,
      });
      expect(controller['factor']).toBe(0.5);
      expect(controller['maxVirtualTime']).toBe(60000);
    });

    it('throws on invalid factor', () => {
      expect(() => new VirtualTimeController(mockBrowser, { factor: 0 })).toThrow(
        'Virtual time factor must be positive',
      );
      expect(() => new VirtualTimeController(mockBrowser, { factor: -1 })).toThrow(
        'Virtual time factor must be positive',
      );
    });
  });

  describe('start', () => {
    it('calls setVirtualTime with configured factor', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      expect(mockBrowser.setVirtualTime).toHaveBeenCalledWith({
        timeDomain: 'time',
        factor: 0.5,
      });
    });

    it('calls setVirtualTime with maxVirtualTime when provided', async () => {
      const controller = new VirtualTimeController(mockBrowser, {
        factor: 1,
        maxVirtualTime: 30000,
      });
      await controller.start();
      expect(mockBrowser.setVirtualTime).toHaveBeenCalledWith({
        timeDomain: 'time',
        factor: 1,
        maxVirtualTime: 30000,
      });
    });

    it('sets enabled flag to true', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 2 });
      await controller.start();
      expect(controller['enabled']).toBe(true);
    });

    it('handles setVirtualTime failure gracefully (fallback)', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('CDP not available'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await expect(controller.start()).resolves.not.toThrow();
      expect(controller['enabled']).toBe(false);
      expect(controller['fallbackActive']).toBe(true);
    });
  });

  describe('stop', () => {
    it('calls resetVirtualTime when virtual time was active', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      await controller.stop();
      expect(mockBrowser.resetVirtualTime).toHaveBeenCalled();
    });

    it('resets enabled flag to false', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      await controller.stop();
      expect(controller['enabled']).toBe(false);
    });

    it('resets fallback flag', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('CDP not available'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      expect(controller['fallbackActive']).toBe(true);
      await controller.stop();
      expect(controller['fallbackActive']).toBe(false);
    });

    it('does nothing when already stopped', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.stop();
      expect(mockBrowser.resetVirtualTime).not.toHaveBeenCalled();
    });

    it('handles resetVirtualTime failure gracefully', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      mockBrowser.resetVirtualTime.mockRejectedValueOnce(new Error('CDP reset failed'));
      await expect(controller.stop()).resolves.not.toThrow();
    });
  });

  describe('apply', () => {
    it('applies a new factor while running', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      await controller.start();
      await controller.applyAsync(0.5);
      expect(mockBrowser.setVirtualTime).toHaveBeenNthCalledWith(2, {
        timeDomain: 'time',
        factor: 0.5,
      });
    });

    it('updates internal factor', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      await controller.start();
      await controller.applyAsync(2);
      expect(controller['factor']).toBe(2);
    });

    it('throws if not started', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      expect(() => controller.apply(0.5)).toThrow('Virtual time not started. Call start() first.');
    });

    it('throws on invalid factor', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      await controller.start();
      expect(() => controller.apply(0)).toThrow('Virtual time factor must be positive');
      expect(() => controller.apply(-1)).toThrow('Virtual time factor must be positive');
    });
  });

  describe('isEnabled', () => {
    it('returns true after start', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      expect(controller.isEnabled()).toBe(true);
    });

    it('returns false after stop', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      await controller.stop();
      expect(controller.isEnabled()).toBe(false);
    });

    it('returns false before start', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      expect(controller.isEnabled()).toBe(false);
    });
  });

  describe('isSupported', () => {
    it('returns true when CDP virtual time works', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      const result = await controller.isSupported();
      expect(result).toBe(true);
    });

    it('returns false when CDP virtual time fails', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('Not supported'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      const result = await controller.isSupported();
      expect(result).toBe(false);
    });

    it('does not leave virtual time active after isSupported check', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      await controller.isSupported();
      expect(controller['enabled']).toBe(false);
    });
  });

  describe('fallback to real time', () => {
    it('sets fallbackActive when CDP fails', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('CDP unavailable'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      expect(controller['fallbackActive']).toBe(true);
      expect(controller.isEnabled()).toBe(false);
    });

    it('fallback does not throw on start', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('CDP unavailable'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await expect(controller.start()).resolves.not.toThrow();
    });

    it('fallback does not throw on stop', async () => {
      mockBrowser.setVirtualTime.mockRejectedValueOnce(new Error('CDP unavailable'));
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      await expect(controller.stop()).resolves.not.toThrow();
    });
  });

  describe('per-step application', () => {
    it('can be applied per-step for different factors', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      await controller.start();

      // Step 1: slow motion
      await controller.applyAsync(0.5);
      expect(mockBrowser.setVirtualTime).toHaveBeenNthCalledWith(2, {
        timeDomain: 'time',
        factor: 0.5,
      });

      // Step 2: fast forward
      await controller.applyAsync(2);
      expect(mockBrowser.setVirtualTime).toHaveBeenNthCalledWith(3, {
        timeDomain: 'time',
        factor: 2,
      });

      // Step 3: back to normal
      await controller.applyAsync(1);
      expect(mockBrowser.setVirtualTime).toHaveBeenNthCalledWith(4, {
        timeDomain: 'time',
        factor: 1,
      });
    });

    it('can be stopped between steps', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5 });
      await controller.start();
      await controller.stop();
      expect(mockBrowser.resetVirtualTime).toHaveBeenCalled();
    });
  });

  describe('lifecycle: start -> apply -> stop', () => {
    it('full lifecycle works correctly', async () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.5, maxVirtualTime: 60000 });
      await controller.start();
      expect(controller.isEnabled()).toBe(true);
      expect(mockBrowser.setVirtualTime).toHaveBeenCalledWith({
        timeDomain: 'time',
        factor: 0.5,
        maxVirtualTime: 60000,
      });

      await controller.applyAsync(2);
      expect(controller['factor']).toBe(2);

      await controller.stop();
      expect(controller.isEnabled()).toBe(false);
      expect(mockBrowser.resetVirtualTime).toHaveBeenCalled();
    });
  });

  describe('factor validation', () => {
    it('allows factor of 1 (no speed change)', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 1 });
      expect(controller['factor']).toBe(1);
    });

    it('allows sub-1 factors (slow motion)', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 0.1 });
      expect(controller['factor']).toBe(0.1);
    });

    it('allows super-1 factors (fast forward)', () => {
      const controller = new VirtualTimeController(mockBrowser, { factor: 10 });
      expect(controller['factor']).toBe(10);
    });
  });
});
