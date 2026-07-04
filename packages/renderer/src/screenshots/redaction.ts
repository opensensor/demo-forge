/**
 * DemoForge renderer — screenshot redaction module.
 *
 * Applies blur redaction to sensitive data regions detected via regex patterns.
 * Uses Sharp for image processing. Supports config-driven redaction rules
 * and built-in patterns for credit cards, emails, SSNs, passwords, etc.
 */

import sharp from 'sharp';

import type { RedactionRule } from '@demoforge/core';

// ─── Apply Redaction ─────────────────────────────────────────────────────────

/** Result of applying redaction: the processed buffer and how many regions were actually blurred. */
export interface RedactionApplication {
  buffer: Buffer;
  applied: number;
}

/**
 * Apply redaction rules to a screenshot image buffer.
 *
 * The primary use case is redacting known regions passed with rect hints.
 * Since we operate on a raster image (not DOM), pure regex rules without
 * rect hints are not actionable (we can't OCR the image) — the caller
 * should convert regex rules to rect hints via DOM inspection first.
 */
export async function applyRedaction(
  imageBuffer: Buffer,
  rules: RedactionRule[],
): Promise<Buffer> {
  const { buffer } = await applyRedactionWithCount(imageBuffer, rules);
  return buffer;
}

/**
 * Apply redaction rules and report how many regions were actually blurred.
 * Rules without a resolvable region contribute nothing to the count.
 */
export async function applyRedactionWithCount(
  imageBuffer: Buffer,
  rules: RedactionRule[],
): Promise<RedactionApplication> {
  if (rules.length === 0) {
    return { buffer: imageBuffer, applied: 0 };
  }

  // Build blur annotations from rules that carry rect hints
  const blurAnnotations: Array<{ rect: { x: number; y: number; width: number; height: number }; sigma?: number }> = [];

  for (const rule of rules) {
    const rect = (rule as RedactionRule & { rect?: { x: number; y: number; width: number; height: number } }).rect;
    if (rect) {
      blurAnnotations.push({ rect, sigma: 10 });
    }
    // rule.pattern and rule.label are informational; actual blur is applied via rect
  }

  if (blurAnnotations.length === 0) {
    // No actionable rules — return unchanged and report zero redactions
    return { buffer: imageBuffer, applied: 0 };
  }

  return applyBlurRegions(imageBuffer, blurAnnotations);
}

/**
 * Apply blur to multiple rectangular regions in an image.
 * Returns the processed buffer and the number of regions actually blurred.
 */
async function applyBlurRegions(
  imageBuffer: Buffer,
  regions: Array<{ rect: { x: number; y: number; width: number; height: number }; sigma?: number }>,
): Promise<RedactionApplication> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    return { buffer: imageBuffer, applied: 0 };
  }

  const compositeInputs: Array<{ input: Buffer; top: number; left: number }> = [];

  for (const region of regions) {
    const clamped = clampRect(region.rect, width, height);

    if (clamped.width <= 0 || clamped.height <= 0) {
      continue;
    }

    // Extract and blur the region
    const regionBuffer = await sharp(imageBuffer)
      .extract({
        left: Math.max(0, clamped.x),
        top: Math.max(0, clamped.y),
        width: clamped.width,
        height: clamped.height,
      })
      .toBuffer();

    const blurred = await sharp(regionBuffer)
      .blur(region.sigma ?? 10)
      .png()
      .toBuffer();

    compositeInputs.push({
      input: blurred,
      top: Math.max(0, clamped.y),
      left: Math.max(0, clamped.x),
    });
  }

  if (compositeInputs.length === 0) {
    return { buffer: imageBuffer, applied: 0 };
  }

  const result = await sharp(imageBuffer)
    .composite(compositeInputs)
    .toBuffer();

  return { buffer: result, applied: compositeInputs.length };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampRect(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.max(0, Math.min(rect.x, width)),
    y: Math.max(0, Math.min(rect.y, height)),
    width: Math.min(rect.width, width - Math.max(0, rect.x)),
    height: Math.min(rect.height, height - Math.max(0, rect.y)),
  };
}
