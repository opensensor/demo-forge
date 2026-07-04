/**
 * DemoForge renderer — screenshot capture module.
 *
 * Captures full-page and element-scoped screenshots via BrowserSession.
 * Produces PNG output with configurable quality.
 */

import sharp from 'sharp';

import type { BrowserSession } from '@demoforge/browser';

import type {
  ScreenshotCaptureOptions,
  ScreenshotResult,
} from './types.js';

import { applyAnnotations } from './annotation.js';
import { applyRedactionWithCount } from './redaction.js';

// ─── ScreenshotCapture ───────────────────────────────────────────────────────

export class ScreenshotCapture {
  private _browser: BrowserSession;

  constructor(browser: BrowserSession) {
    this._browser = browser;
  }

  /**
   * Capture a full-page screenshot (entire scrollable page).
   */
  async captureFullPage(options: Omit<ScreenshotCaptureOptions, 'mode'> = {}): Promise<ScreenshotResult> {
    return this.capture({ ...options, mode: 'full-page' });
  }

  /**
   * Capture an element-scoped screenshot (only the targeted element).
   */
  async captureElement(selector: import('@demoforge/browser').Selector, options: Omit<ScreenshotCaptureOptions, 'mode'> = {}): Promise<ScreenshotResult> {
    return this.capture({ ...options, mode: 'element', elementSelector: selector });
  }

  /**
   * Capture a screenshot with the given options.
   */
  async capture(options: ScreenshotCaptureOptions): Promise<ScreenshotResult> {
    const mode = options.mode ?? 'full-page';
    const quality = options.quality ?? 95;
    const annotations = options.annotations ?? [];
    const redactionRules = options.redactionRules ?? [];
    const autoRedact = options.autoRedact ?? false;

    // Capture raw screenshot from browser
    const browserOpts: Parameters<typeof this._browser.screenshot>[0] = {
      fullPage: mode === 'full-page',
      type: 'png',
    };

    if (mode === 'element' && options.elementSelector) {
      browserOpts.element = options.elementSelector;
    }

    const rawBuffer = await this._browser.screenshot(browserOpts);

    // Apply redaction (blur sensitive data regions)
    let processedBuffer = rawBuffer;
    let redactionsApplied = 0;

    if (redactionRules.length > 0 || autoRedact) {
      const builtInRules = autoRedact ? getBuiltInRedactionRules() : [];
      const allRules = [...builtInRules, ...redactionRules];
      // Only count redactions that were actually applied — rules without a
      // resolvable region (pure regex patterns) blur nothing.
      const redactionResult = await applyRedactionWithCount(processedBuffer, allRules);
      processedBuffer = redactionResult.buffer;
      redactionsApplied = redactionResult.applied;
    }

    // Apply annotations (boxes, arrows, blur regions)
    let finalBuffer = processedBuffer;
    let annotationsApplied = 0;

    if (annotations.length > 0) {
      finalBuffer = await applyAnnotations(processedBuffer, annotations);
      annotationsApplied = annotations.length;
    }

    // Compress to target quality
    let outputBuffer = finalBuffer;
    if (quality < 100) {
      outputBuffer = await sharp(finalBuffer)
        .png({ quality })
        .toBuffer();
    }

    // Write to file if path specified
    let outputPath: string | undefined;
    if (options.outputPath) {
      const fs = await import('node:fs');
      await fs.promises.writeFile(options.outputPath, outputBuffer);
      outputPath = options.outputPath;
    }

    // Get page state for metadata
    const state = await this._browser.getState();

    return {
      buffer: outputBuffer,
      url: state.url,
      title: state.title,
      viewport: state.viewport,
      dimensions: state.viewport,
      annotationsApplied,
      redactionsApplied,
      outputPath,
    };
  }
}

/**
 * Built-in auto-redaction rules for common sensitive data patterns.
 */
function getBuiltInRedactionRules(): Array<{ pattern: string; label: string }> {
  return [
    { pattern: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b', label: 'credit-card' },
    { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', label: 'ssn' },
    { pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', label: 'email' },
    { pattern: '(?:password|passwd|pwd)\\s*[:=]\\s*\\S+', label: 'password' },
    { pattern: '(?:api[_-]?key|apikey)\\s*[:=]\\s*\\S+', label: 'api-key' },
    { pattern: 'Bearer\\s+[a-zA-Z0-9._-]+', label: 'bearer-token' },
  ];
}
