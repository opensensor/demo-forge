/**
 * DemoForge renderer — virtual time controller.
 *
 * Manages CDP virtual time injection for stabilizing animated UIs.
 * Sets timeDomain: "time" and overrides Page.setTimeDomain via CDP.
 * Configurable virtual time factor (0.5x slow motion, 2x fast forward).
 * Falls back to real time if CDP virtual time is not supported.
 */

import type { BrowserSession, VirtualTimeOptions } from '@demoforge/browser';

export interface VirtualTimeConfig {
  /** Virtual time factor (e.g., 0.5 for slow motion, 2 for fast forward). Default: 1. */
  factor?: number;
  /** Maximum virtual time in milliseconds. Default: 0 (unlimited). */
  maxVirtualTime?: number;
}

export class VirtualTimeController {
  private _browser: BrowserSession;
  private _factor: number;
  private _maxVirtualTime: number;
  private _enabled = false;
  private _fallbackActive = false;

  constructor(browser: BrowserSession, config?: VirtualTimeConfig) {
    this._browser = browser;
    this._factor = config?.factor ?? 1;
    this._maxVirtualTime = config?.maxVirtualTime ?? 0;

    if (this._factor <= 0) {
      throw new Error('Virtual time factor must be positive');
    }
  }

  get factor(): number {
    return this._factor;
  }

  get maxVirtualTime(): number {
    return this._maxVirtualTime;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get fallbackActive(): boolean {
    return this._fallbackActive;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      const options: VirtualTimeOptions = {
        timeDomain: 'time',
        factor: this._factor,
      };
      if (this._maxVirtualTime > 0) {
        options.maxVirtualTime = this._maxVirtualTime;
      }
      await this._browser.setVirtualTime(options);
      this._enabled = true;
      this._fallbackActive = false;
    } catch {
      // CDP virtual time not supported — fall back to real time
      this._enabled = false;
      this._fallbackActive = true;
    }
  }

  async stop(): Promise<void> {
    if (!this._enabled && !this._fallbackActive) {
      return;
    }
    try {
      await this._browser.resetVirtualTime();
    } catch {
      // CDP reset failed — virtual time may still be active, but we
      // treat it as stopped to avoid leaving the browser in a weird state
    }
    this._enabled = false;
    this._fallbackActive = false;
  }

  // ─── Runtime Control ────────────────────────────────────────────────────

  apply(factor: number): void {
    if (factor <= 0) {
      throw new Error('Virtual time factor must be positive');
    }
    if (!this._enabled) {
      throw new Error('Virtual time not started. Call start() first.');
    }
    this._factor = factor;
  }

  async applyAsync(factor: number): Promise<void> {
    this.apply(factor);
    await this._browser.setVirtualTime({
      timeDomain: 'time',
      factor,
    });
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  // ─── Support Detection ──────────────────────────────────────────────────

  async isSupported(): Promise<boolean> {
    try {
      await this._browser.setVirtualTime({
        timeDomain: 'time',
        factor: 1,
      });
      return true;
    } catch {
      return false;
    }
  }
}
