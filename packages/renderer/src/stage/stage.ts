/**
 * DemoForge stage — renderer-side driver for the in-page overlay.
 *
 * Every call evaluates against the live page (never an init script), so
 * effects appear in the frame being recorded. Calls are best-effort: a page
 * mid-navigation must not fail the demo because an overlay could not draw.
 */

import type { BoundingBox, BrowserSession } from '@demoforge/browser';

import { STAGE_SCRIPT } from './stage-script.js';

export interface StageOptions {
  /** Show the synthetic cursor. Default: true. */
  cursor?: boolean;
}

export class Stage {
  private _browser: BrowserSession;
  private _cursor: boolean;

  constructor(browser: BrowserSession, options: StageOptions = {}) {
    this._browser = browser;
    this._cursor = options.cursor ?? true;
  }

  get cursorEnabled(): boolean {
    return this._cursor;
  }

  /** Register the overlay for future documents and draw it on the current one. */
  async install(): Promise<void> {
    await this._browser.addInitScript(STAGE_SCRIPT);
    if (!this._cursor) {
      await this._browser.addInitScript('window.__dfStage && window.__dfStage.setCursorEnabled(false);');
    }
    await this._call('ensure()');
  }

  /** Current cursor position in viewport coordinates. */
  async cursorPosition(): Promise<{ x: number; y: number } | null> {
    return this._call<{ x: number; y: number }>('pos');
  }

  /** Glide the cursor to (x, y); duration scales with distance unless given. */
  async moveTo(x: number, y: number, durationMs?: number): Promise<void> {
    if (!this._cursor) return;
    let ms = durationMs;
    if (ms === undefined) {
      const from = await this.cursorPosition();
      const distance = from ? Math.hypot(x - from.x, y - from.y) : 600;
      ms = Math.round(Math.min(1100, Math.max(380, 260 + distance * 0.75)));
    }
    await this._call(`moveTo(${x}, ${y}, ${ms})`);
  }

  async clickRipple(): Promise<void> {
    if (!this._cursor) return;
    await this._call('click()');
  }

  /** Dim the page except `box` (or just ring it when `dim` is false). */
  async spotlight(box: BoundingBox, dim = true): Promise<void> {
    await this._call(`spotlight(${JSON.stringify(box)}, { dim: ${dim} })`);
  }

  async callout(box: BoundingBox, text: string): Promise<void> {
    await this._call(`callout(${JSON.stringify(box)}, ${JSON.stringify(text)})`);
  }

  /** Remove spotlight and callout (fades out). */
  async clear(): Promise<void> {
    await this._call('clear()');
  }

  /** Zoom the page content toward `box`; pass null (or scale 1) to reset. */
  async zoom(box: BoundingBox | null, scale = 1.6, durationMs = 700): Promise<void> {
    await this._call(`zoom(${box ? JSON.stringify(box) : 'null'}, ${box ? scale : 1}, ${durationMs})`);
  }

  /** Hide or show the whole overlay (e.g. around screenshots). */
  async setHidden(hidden: boolean): Promise<void> {
    await this._call(`setHidden(${hidden})`);
  }

  private async _call<T = unknown>(expr: string): Promise<T | null> {
    try {
      return await this._browser.evaluate<T>(
        `(async () => { if (!window.__dfStage) { ${STAGE_SCRIPT} } return window.__dfStage.${expr}; })()`,
      );
    } catch {
      return null;
    }
  }
}
