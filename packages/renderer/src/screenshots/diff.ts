/**
 * DemoForge renderer — before/after screenshot diff module.
 *
 * Compares two screenshot images and produces a combined diff report.
 * Supports side-by-side and overlay comparison modes.
 */

import sharp from 'sharp';

import type { DiffOptions, DiffResult } from './types.js';

// ─── Compare Screenshots ─────────────────────────────────────────────────────

/**
 * Compare two screenshots and produce a diff report image.
 *
 * @param before — Buffer of the "before" screenshot (PNG)
 * @param after — Buffer of the "after" screenshot (PNG)
 * @param options — Comparison options
 */
export async function compareScreenshots(
  before: Buffer,
  after: Buffer,
  options: DiffOptions = {},
): Promise<DiffResult> {
  const mode = options.mode ?? 'side-by-side';
  const beforeLabel = options.beforeLabel ?? 'Before';
  const afterLabel = options.afterLabel ?? 'After';
  const spacing = options.spacing ?? 20;
  const backgroundColor = options.backgroundColor ?? '#1a1a2e';
  const labelFontSize = options.labelFontSize ?? 16;
  const quality = options.quality ?? 95;

  // Get dimensions of both images
  const beforeMeta = await sharp(before).metadata();
  const afterMeta = await sharp(after).metadata();

  const beforeWidth = beforeMeta.width ?? 0;
  const beforeHeight = beforeMeta.height ?? 0;
  const afterWidth = afterMeta.width ?? 0;
  const afterHeight = afterMeta.height ?? 0;

  if (beforeWidth === 0 || beforeHeight === 0 || afterWidth === 0 || afterHeight === 0) {
    throw new Error('Invalid screenshot dimensions');
  }

  // Calculate pixel diff
  const pixelDiff = await calculatePixelDiff(before, after);

  // Generate diff image based on mode
  let diffBuffer: Buffer;

  if (mode === 'side-by-side') {
    diffBuffer = await createSideBySide(
      before, after,
      beforeWidth, beforeHeight,
      afterWidth, afterHeight,
      beforeLabel, afterLabel,
      spacing, backgroundColor, labelFontSize,
    );
  } else {
    diffBuffer = await createOverlay(
      before, after,
      beforeWidth, beforeHeight,
      beforeLabel, afterLabel,
      backgroundColor, labelFontSize,
    );
  }

  // Compress to target quality
  let outputBuffer = diffBuffer;
  if (quality < 100) {
    outputBuffer = await sharp(diffBuffer)
      .png({ quality })
      .toBuffer();
  }

  // Write to file if path specified
  if (options.outputPath) {
    const fs = await import('node:fs');
    await fs.promises.writeFile(options.outputPath, outputBuffer);
  }

  const totalPixels = Math.max(beforeWidth * beforeHeight, afterWidth * afterHeight);
  const similarity = totalPixels > 0 ? 1 - pixelDiff / totalPixels : 1;

  return {
    buffer: outputBuffer,
    pixelDiff,
    totalPixels,
    similarity,
    outputPath: options.outputPath,
  };
}

// ─── Side-by-Side Mode ───────────────────────────────────────────────────────

async function createSideBySide(
  before: Buffer,
  after: Buffer,
  beforeWidth: number,
  beforeHeight: number,
  afterWidth: number,
  afterHeight: number,
  beforeLabel: string,
  afterLabel: string,
  spacing: number,
  backgroundColor: string,
  labelFontSize: number,
): Promise<Buffer> {
  const labelHeight = labelFontSize + 16;
  const totalWidth = beforeWidth + spacing + afterWidth;
  const totalHeight = Math.max(beforeHeight, afterHeight) + labelHeight;

  // Create canvas with background
  const canvas = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">
      <rect width="100%" height="100%" fill="${backgroundColor}"/>
    </svg>`,
    'utf-8',
  );

  const canvasBuffer = await sharp(canvas).png().toBuffer();

  // Create label overlays
  const beforeLabelSvg = createLabelSvg(beforeLabel, beforeWidth, labelFontSize, backgroundColor);
  const afterLabelSvg = createLabelSvg(afterLabel, afterWidth, labelFontSize, backgroundColor);

  const beforeLabelBuffer = await sharp(Buffer.from(beforeLabelSvg, 'utf-8'))
    .png()
    .resize({ width: beforeWidth, height: labelHeight })
    .toBuffer();

  const afterLabelBuffer = await sharp(Buffer.from(afterLabelSvg, 'utf-8'))
    .png()
    .resize({ width: afterWidth, height: labelHeight })
    .toBuffer();

  // Composite everything
  const result = await sharp(canvasBuffer)
    .composite([
      { input: beforeLabelBuffer, top: 0, left: 0 },
      { input: afterLabelBuffer, top: 0, left: beforeWidth + spacing },
      { input: before, top: labelHeight, left: 0 },
      { input: after, top: labelHeight, left: beforeWidth + spacing },
    ])
    .toBuffer();

  return result;
}

// ─── Overlay Mode ────────────────────────────────────────────────────────────

async function createOverlay(
  before: Buffer,
  after: Buffer,
  _beforeWidth: number,
  _beforeHeight: number,
  beforeLabel: string,
  afterLabel: string,
  _backgroundColor: string,
  labelFontSize: number,
): Promise<Buffer> {
  // Use after image as base, draw before image with transparency
  const labelHeight = labelFontSize + 16;

  // Create a semi-transparent overlay of the "before" image
  const beforeWithLabel = await sharp(before)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
            <rect width="100%" height="${labelHeight}" fill="rgba(0,0,0,0.7)"/>
            <text x="8" y="${labelFontSize + 4}" fill="white" font-size="${labelFontSize}" font-family="sans-serif">${escapeXml(beforeLabel)}</text>
          </svg>`,
          'utf-8',
        ),
        blend: 'over',
      },
    ])
    .toBuffer();

  const afterWithLabel = await sharp(after)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
            <rect width="100%" height="${labelHeight}" fill="rgba(0,0,0,0.7)"/>
            <text x="8" y="${labelFontSize + 4}" fill="white" font-size="${labelFontSize}" font-family="sans-serif">${escapeXml(afterLabel)}</text>
          </svg>`,
          'utf-8',
        ),
        blend: 'over',
      },
    ])
    .toBuffer();

  // Composite: before on top of after
  const result = await sharp(afterWithLabel)
    .composite([
      {
        input: beforeWithLabel,
        blend: 'over',
      },
    ])
    .toBuffer();

  return result;
}

// ─── Pixel Diff ──────────────────────────────────────────────────────────────

/**
 * Calculate the number of different pixels between two images.
 * Uses pixel-wise comparison after resizing to same dimensions.
 */
async function calculatePixelDiff(before: Buffer, after: Buffer): Promise<number> {
  const beforeMeta = await sharp(before).metadata();
  const afterMeta = await sharp(after).metadata();

  const bw = beforeMeta.width ?? 0;
  const bh = beforeMeta.height ?? 0;
  const aw = afterMeta.width ?? 0;
  const ah = afterMeta.height ?? 0;

  if (bw === 0 || bh === 0 || aw === 0 || ah === 0) {
    return 0;
  }

  // Resize to common dimensions for comparison
  const commonWidth = Math.max(bw, aw);
  const commonHeight = Math.max(bh, ah);

  const [beforeResized, afterResized] = await Promise.all([
    sharp(before).resize(commonWidth, commonHeight).raw().toBuffer({ resolveWithObject: true }),
    sharp(after).resize(commonWidth, commonHeight).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const beforeData = beforeResized.data;
  const afterData = afterResized.data;
  const length = Math.min(beforeData.length, afterData.length);

  let diffCount = 0;
  for (let i = 0; i < length; i += 4) {
    // Compare RGBA channels
    if (
      beforeData[i] !== afterData[i] ||
      beforeData[i + 1] !== afterData[i + 1] ||
      beforeData[i + 2] !== afterData[i + 2] ||
      beforeData[i + 3] !== afterData[i + 3]
    ) {
      diffCount++;
    }
  }

  return diffCount;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createLabelSvg(text: string, width: number, fontSize: number, bgColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fontSize + 16}">
    <rect width="100%" height="100%" fill="${bgColor}"/>
    <rect width="100%" height="${fontSize + 16}" fill="rgba(0,0,0,0.7)"/>
    <text x="8" y="${fontSize + 4}" fill="white" font-size="${fontSize}" font-family="sans-serif">${escapeXml(text)}</text>
  </svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
