/**
 * DemoForge renderer — SSIM (Structural Similarity Index) calculation.
 *
 * Pure JavaScript implementation using grayscale conversion and
 * sliding-window comparison. No external dependencies required.
 *
 * SSIM formula (per-window):
 *   SSIM(x,y) = (2*μx*μy + C1)(2*σxy + C2) / (μx² + μy² + C1)(σx² + σy² + C2)
 *
 * Final score = mean of all window SSIM values.
 */

import sharp from 'sharp';

// SSIM constants for numerical stability
const C1 = 0.01 ** 2;
const C2 = (0.03 ** 2) * 3;

/**
 * Calculate SSIM between two image buffers.
 *
 * @param a — Buffer of the first image (PNG)
 * @param b — Buffer of the second image (PNG)
 * @returns SSIM score (0-1, 1 = identical)
 */
export async function calculateSSIM(a: Buffer, b: Buffer): Promise<number> {
  if (a.length === 0 || b.length === 0) {
    return 1;
  }

  // Resize both images to a common size for comparison
  const targetWidth = 256;
  const targetHeight = 256;

  const grayAResult = await sharp(a).resize(targetWidth, targetHeight).raw().toBuffer({ resolveWithObject: true });
  const grayBResult = await sharp(b).resize(targetWidth, targetHeight).raw().toBuffer({ resolveWithObject: true });

  const dataA = grayAResult.data;
  const dataB = grayBResult.data;
  const width = grayAResult.info.width !== undefined ? grayAResult.info.width : targetWidth;
  const height = grayAResult.info.height !== undefined ? grayAResult.info.height : targetHeight;

  if (dataA.length === 0 || dataB.length === 0) {
    return 1;
  }

  // Extract grayscale values (first byte of each RGBA pixel)
  const pixelsA: number[] = [];
  const pixelsB: number[] = [];

  for (let i = 0; i < dataA.length && i < dataB.length; i += 4) {
    const aByte = dataA[i] as number;
    const bByte = dataB[i] as number;
    pixelsA.push(aByte);
    pixelsB.push(bByte);
  }

  // Sliding window SSIM
  const windowSize = 8;
  const ssimValues: number[] = [];

  for (let y = 0; y <= height - windowSize; y += windowSize) {
    for (let x = 0; x <= width - windowSize; x += windowSize) {
      const windowA: number[] = [];
      const windowB: number[] = [];

      for (let wy = 0; wy < windowSize; wy++) {
        for (let wx = 0; wx < windowSize; wx++) {
          const idx = (y + wy) * width + (x + wx);
          if (idx < pixelsA.length && idx < pixelsB.length) {
            const aVal = pixelsA[idx] as number;
            const bVal = pixelsB[idx] as number;
            windowA.push(aVal);
            windowB.push(bVal);
          }
        }
      }

      if (windowA.length > 0 && windowB.length > 0) {
        ssimValues.push(ssimWindow(windowA, windowB));
      }
    }
  }

  // Mean SSIM across all windows
  return ssimValues.length > 0
    ? ssimValues.reduce((sum, v) => sum + v, 0) / ssimValues.length
    : 1;
}

/**
 * Calculate SSIM for a single window of two pixel arrays.
 */
function ssimWindow(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return 1;

  // Means
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  // Variances and covariance
  let varA = 0;
  let varB = 0;
  let covAB = 0;

  for (let i = 0; i < n; i++) {
    const aVal = a[i] as number;
    const bVal = b[i] as number;
    const da = aVal - meanA;
    const db = bVal - meanB;
    varA += da * da;
    varB += db * db;
    covAB += da * db;
  }

  const divisor = Math.max(n - 1, 1);
  varA /= divisor;
  varB /= divisor;
  covAB /= divisor;

  // SSIM formula
  const numerator = (2 * meanA * meanB + C1) * (2 * covAB + C2);
  const denominator = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2);

  return denominator === 0 ? 1 : numerator / denominator;
}
