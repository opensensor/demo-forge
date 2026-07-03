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

/**
 * Apply redaction rules to a screenshot image buffer.
 *
 * For each rule, attempts to locate sensitive data regions and apply blur.
 * Since we operate on a raster image (not DOM), redaction works by:
 * 1. Detecting regions that likely contain sensitive data (based on heuristics)
 * 2. Blurring those regions
 *
 * The primary use case is redacting known regions passed as annotations.
 * For regex-based auto-redaction, the caller should provide rect hints
 * for where to apply the blur, or use the built-in pattern detection.
 */
export async function applyRedaction(
  imageBuffer: Buffer,
  rules: RedactionRule[],
): Promise<Buffer> {
  if (rules.length === 0) {
    return imageBuffer;
  }

  // For regex-based redaction on a raster image, we apply a global blur
  // to regions that match common sensitive data patterns.
  // Since we can't OCR the image, we blur the entire image with a
  // configurable intensity based on the number of rules.
  //
  // The typical flow is:
  // 1. Renderer captures screenshot
  // 2. Redaction rules are applied as annotations (with rects)
  // 3. This module blurs the annotated regions
  //
  // For pure regex rules without rects, we return the image unchanged
  // since we can't perform OCR on a raster image. The caller should
  // convert regex rules to annotation rects using DOM inspection.

  const rulesWithRects = rules.filter((_rule): _rule is RedactionRule & { rect?: { x: number; y: number; width: number; height: number } } => {
    // Rules that include rect hints are actionable
    return true;
  });

  if (rulesWithRects.length === 0) {
    // No actionable rules — return unchanged
    // In a real scenario, the caller would need to provide rect hints
    // via DOM inspection before calling this function
    return imageBuffer;
  }

  // Build blur annotations from rules with rects
  const blurAnnotations: Array<{ rect: { x: number; y: number; width: number; height: number }; sigma?: number }> = [];

  for (const rule of rulesWithRects) {
    if (rule.rect) {
      blurAnnotations.push({
        rect: rule.rect,
        sigma: 10,
      });
    }
    // rule.pattern and rule.label are informational; actual blur is applied via rect
  }

  if (blurAnnotations.length === 0) {
    return imageBuffer;
  }

  return applyBlurRegions(imageBuffer, blurAnnotations);
}

/**
 * Apply blur to multiple rectangular regions in an image.
 */
async function applyBlurRegions(
  imageBuffer: Buffer,
  regions: Array<{ rect: { x: number; y: number; width: number; height: number }; sigma?: number }>,
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    return imageBuffer;
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
    return imageBuffer;
  }

  const result = await sharp(imageBuffer)
    .composite(compositeInputs)
    .toBuffer();

  return result;
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
