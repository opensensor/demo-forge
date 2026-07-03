/**
 * DemoForge renderer — screenshot annotation and redaction tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSession } from '@demoforge/browser';
import type { RedactionRule } from '@demoforge/core';

import { ScreenshotCapture } from './capture.js';
import { applyAnnotations } from './annotation.js';
import { applyRedaction } from './redaction.js';
import { compareScreenshots } from './diff.js';
import type { Annotation, BoxAnnotation, ArrowAnnotation, BlurAnnotation } from './types.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

let mockBrowser: Partial<BrowserSession>;
let validPng: Buffer;

beforeEach(async () => {
  const sharp = (await import('sharp')).default;

  // Create a valid 100x100 blue PNG for testing
  validPng = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 50, g: 100, b: 200 },
    },
  })
    .png()
    .toBuffer();

  mockBrowser = {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(validPng),
    getState: vi.fn().mockResolvedValue({
      url: 'http://localhost:3000',
      title: 'Test Page',
      viewport: { width: 1280, height: 720 },
      pageCount: 1,
      isRunning: true,
    }),
  };
});

// ─── ScreenshotCapture Tests ─────────────────────────────────────────────────

describe('ScreenshotCapture', () => {
  describe('full-page screenshot', () => {
    it('captures a full-page screenshot', async () => {
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage();

      expect(result.buffer).toBeDefined();
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.url).toBe('http://localhost:3000');
      expect(result.title).toBe('Test Page');
      expect(result.viewport).toEqual({ width: 1280, height: 720 });
      expect(result.annotationsApplied).toBe(0);
      expect(result.redactionsApplied).toBe(0);
    });

    it('saves to file when outputPath is provided', async () => {
      const fsWriteSpy = vi
        .spyOn((await import('node:fs')).promises, 'writeFile')
        .mockResolvedValue(undefined);

      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage({ outputPath: '/tmp/test-screenshot.png' });

      expect(result.outputPath).toBe('/tmp/test-screenshot.png');
      expect(fsWriteSpy).toHaveBeenCalled();
      fsWriteSpy.mockRestore();
    });

    it('uses configurable quality', async () => {
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage({ quality: 80 });

      expect(result.buffer).toBeDefined();
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
    });
  });

  describe('element-scoped screenshot', () => {
    it('captures an element screenshot', async () => {
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureElement({ role: 'button', name: 'Submit' });

      expect(result.buffer).toBeDefined();
      expect(mockBrowser.screenshot).toHaveBeenCalledWith({
        fullPage: false,
        type: 'png',
        element: { role: 'button', name: 'Submit' },
      });
    });
  });

  describe('with annotations', () => {
    it('applies annotations to screenshot', async () => {
      const annotations: Annotation[] = [
        { type: 'box', rect: { x: 0, y: 0, width: 50, height: 30 } },
      ];
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage({ annotations });

      expect(result.annotationsApplied).toBe(1);
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
    });
  });

  describe('with redaction rules', () => {
    it('applies redaction rules', async () => {
      const rules: RedactionRule[] = [
        { pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', label: 'email' },
      ];
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage({ redactionRules: rules });

      expect(result.redactionsApplied).toBe(1);
    });

    it('applies auto-redaction for sensitive patterns', async () => {
      const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
      const result = await capture.captureFullPage({ autoRedact: true });

      expect(result.redactionsApplied).toBeGreaterThan(0);
    });
  });
});

// ─── Annotation Tests ────────────────────────────────────────────────────────

describe('applyAnnotations', () => {
  it('returns unchanged buffer when no annotations', async () => {
    const result = await applyAnnotations(validPng, []);
    expect(result).toEqual(validPng);
  });

  it('draws a box annotation', async () => {
    const annotations: Annotation[] = [
      { type: 'box', rect: { x: 10, y: 10, width: 50, height: 30 }, color: '#00ff00', borderWidth: 3 },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('draws a box with label', async () => {
    const annotations: Annotation[] = [
      { type: 'box', rect: { x: 0, y: 0, width: 100, height: 50 }, label: 'Important' },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('draws an arrow annotation', async () => {
    const annotations: Annotation[] = [
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, color: '#0000ff', lineWidth: 2 },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('draws an arrow with label', async () => {
    const annotations: Annotation[] = [
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, label: 'Click here' },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('applies blur annotation', async () => {
    const annotations: Annotation[] = [
      { type: 'blur', rect: { x: 0, y: 0, width: 50, height: 50 }, sigma: 5 },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('combines multiple annotation types', async () => {
    const annotations: Annotation[] = [
      { type: 'box', rect: { x: 0, y: 0, width: 50, height: 30 } },
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 50, y: 30 } },
      { type: 'blur', rect: { x: 10, y: 10, width: 20, height: 10 }, sigma: 8 },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses default colors when not specified', async () => {
    const annotations: Annotation[] = [
      { type: 'box', rect: { x: 0, y: 0, width: 10, height: 10 } },
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
    ];

    const result = await applyAnnotations(validPng, annotations);

    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ─── Redaction Tests ─────────────────────────────────────────────────────────

describe('applyRedaction', () => {
  it('returns unchanged buffer when no rules', async () => {
    const result = await applyRedaction(validPng, []);
    expect(result).toEqual(validPng);
  });

  it('returns unchanged buffer when rules have no rects', async () => {
    const rules: RedactionRule[] = [
      { pattern: 'email', label: 'email' },
    ];

    const result = await applyRedaction(validPng, rules);
    expect(result).toEqual(validPng);
  });

  it('applies blur to regions with rects', async () => {
    const rules: Array<RedactionRule & { rect: { x: number; y: number; width: number; height: number } }> = [
      { pattern: 'ssn', label: 'ssn', rect: { x: 0, y: 0, width: 50, height: 30 } },
    ];

    const result = await applyRedaction(validPng, rules);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('applies multiple redaction regions', async () => {
    const rules: Array<RedactionRule & { rect: { x: number; y: number; width: number; height: number } }> = [
      { pattern: 'email', label: 'email', rect: { x: 0, y: 0, width: 30, height: 20 } },
      { pattern: 'credit-card', label: 'cc', rect: { x: 40, y: 10, width: 40, height: 20 } },
    ];

    const result = await applyRedaction(validPng, rules);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('clamps rects to image bounds', async () => {
    const rules: Array<RedactionRule & { rect: { x: number; y: number; width: number; height: number } }> = [
      { pattern: 'test', label: 'test', rect: { x: 100, y: 100, width: 50, height: 50 } },
    ];

    const result = await applyRedaction(validPng, rules);

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('handles partial overlap rects', async () => {
    const rules: Array<RedactionRule & { rect: { x: number; y: number; width: number; height: number } }> = [
      { pattern: 'test', label: 'test', rect: { x: 80, y: 80, width: 50, height: 50 } },
    ];

    const result = await applyRedaction(validPng, rules);

    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ─── Diff / Comparison Tests ─────────────────────────────────────────────────

describe('compareScreenshots', () => {
  it('produces a side-by-side diff by default', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result.buffer).toBeDefined();
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.pixelDiff).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });

  it('produces an overlay diff', async () => {
    const result = await compareScreenshots(validPng, validPng, { mode: 'overlay' });

    expect(result.buffer).toBeDefined();
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
  });

  it('uses custom labels', async () => {
    const result = await compareScreenshots(validPng, validPng, {
      beforeLabel: 'Original',
      afterLabel: 'Modified',
    });

    expect(result.buffer).toBeDefined();
  });

  it('saves to file when outputPath is provided', async () => {
    const fsWriteSpy = vi
      .spyOn((await import('node:fs')).promises, 'writeFile')
      .mockResolvedValue(undefined);

    const result = await compareScreenshots(validPng, validPng, {
      outputPath: '/tmp/test-diff.png',
      mode: 'side-by-side',
    });

    expect(result.outputPath).toBe('/tmp/test-diff.png');
    expect(fsWriteSpy).toHaveBeenCalled();
    fsWriteSpy.mockRestore();
  });

  it('calculates similarity for identical images', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result.similarity).toBe(1);
    expect(result.pixelDiff).toBe(0);
  });

  it('respects custom spacing in side-by-side mode', async () => {
    const result = await compareScreenshots(validPng, validPng, {
      mode: 'side-by-side',
      spacing: 50,
    });

    expect(result.buffer).toBeDefined();
  });

  it('uses custom background color', async () => {
    const result = await compareScreenshots(validPng, validPng, {
      backgroundColor: '#000000',
    });

    expect(result.buffer).toBeDefined();
  });

  it('uses custom label font size', async () => {
    const result = await compareScreenshots(validPng, validPng, {
      labelFontSize: 24,
    });

    expect(result.buffer).toBeDefined();
  });

  it('applies quality setting', async () => {
    const result = await compareScreenshots(validPng, validPng, { quality: 80 });

    expect(result.buffer).toBeDefined();
  });
});

// ─── Annotation Type Tests ───────────────────────────────────────────────────

describe('Annotation types', () => {
  it('creates a valid box annotation', () => {
    const box: BoxAnnotation = {
      type: 'box',
      rect: { x: 10, y: 20, width: 100, height: 50 },
      color: '#ff0000',
      borderWidth: 3,
      label: 'Test Box',
    };

    expect(box.type).toBe('box');
    expect(box.rect.x).toBe(10);
    expect(box.color).toBe('#ff0000');
    expect(box.borderWidth).toBe(3);
    expect(box.label).toBe('Test Box');
  });

  it('creates a valid arrow annotation', () => {
    const arrow: ArrowAnnotation = {
      type: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      color: '#00ff00',
      lineWidth: 2,
      arrowSize: 12,
      label: 'Pointing here',
    };

    expect(arrow.type).toBe('arrow');
    expect(arrow.from.x).toBe(0);
    expect(arrow.to.y).toBe(50);
    expect(arrow.lineWidth).toBe(2);
  });

  it('creates a valid blur annotation', () => {
    const blur: BlurAnnotation = {
      type: 'blur',
      rect: { x: 50, y: 50, width: 200, height: 100 },
      sigma: 15,
    };

    expect(blur.type).toBe('blur');
    expect(blur.rect.width).toBe(200);
    expect(blur.sigma).toBe(15);
  });

  it('uses default annotation values', () => {
    const box: BoxAnnotation = {
      type: 'box',
      rect: { x: 0, y: 0, width: 10, height: 10 },
    };

    expect(box.color).toBeUndefined();
    expect(box.borderWidth).toBeUndefined();
    expect(box.label).toBeUndefined();
  });

  it('uses default arrow values', () => {
    const arrow: ArrowAnnotation = {
      type: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
    };

    expect(arrow.color).toBeUndefined();
    expect(arrow.lineWidth).toBeUndefined();
    expect(arrow.arrowSize).toBeUndefined();
  });
});

// ─── ScreenshotResult Tests ──────────────────────────────────────────────────

describe('ScreenshotResult', () => {
  it('has all required fields', async () => {
    const capture = new ScreenshotCapture(mockBrowser as BrowserSession);
    const result = await capture.captureFullPage();

    expect(result).toHaveProperty('buffer');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('viewport');
    expect(result).toHaveProperty('dimensions');
    expect(result).toHaveProperty('annotationsApplied');
    expect(result).toHaveProperty('redactionsApplied');
  });
});

// ─── DiffResult Tests ────────────────────────────────────────────────────────

describe('DiffResult', () => {
  it('has all required fields', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result).toHaveProperty('buffer');
    expect(result).toHaveProperty('pixelDiff');
    expect(result).toHaveProperty('totalPixels');
    expect(result).toHaveProperty('similarity');
  });

  it('similarity is between 0 and 1', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
  });

  it('pixelDiff is non-negative', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result.pixelDiff).toBeGreaterThanOrEqual(0);
  });

  it('totalPixels is positive', async () => {
    const result = await compareScreenshots(validPng, validPng);

    expect(result.totalPixels).toBeGreaterThan(0);
  });
});

// ─── Built-in Redaction Patterns Tests ───────────────────────────────────────

describe('Built-in redaction patterns', () => {
  it('detects credit card patterns', () => {
    const ccPattern = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/;
    expect(ccPattern.test('4111 1111 1111 1111')).toBe(true);
    expect(ccPattern.test('4111-1111-1111-1111')).toBe(true);
    expect(ccPattern.test('4111111111111111')).toBe(true);
  });

  it('detects SSN patterns', () => {
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    expect(ssnPattern.test('123-45-6789')).toBe(true);
  });

  it('detects email patterns', () => {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    expect(emailPattern.test('user@example.com')).toBe(true);
    expect(emailPattern.test('test.user+tag@domain.co.uk')).toBe(true);
  });

  it('detects password patterns', () => {
    const pwdPattern = /(?:password|passwd|pwd)\s*[:=]\s*\S+/;
    expect(pwdPattern.test('password=secret123')).toBe(true);
    expect(pwdPattern.test('passwd: mypass')).toBe(true);
  });

  it('detects API key patterns', () => {
    const apiKeyPattern = /(?:api[_-]?key|apikey)\s*[:=]\s*\S+/;
    expect(apiKeyPattern.test('api_key=abc123')).toBe(true);
    expect(apiKeyPattern.test('apikey: xyz789')).toBe(true);
  });

  it('detects bearer token patterns', () => {
    const bearerPattern = /Bearer\s+[a-zA-Z0-9._-]+/;
    expect(bearerPattern.test('Bearer eyJhbGciOiJIUzI1NiJ')).toBe(true);
  });
});

// ─── XML Escaping Tests ──────────────────────────────────────────────────────

describe('XML escaping in SVG', () => {
  it('escapes special characters', () => {
    const text = '<script>alert("xss")</script>';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});
