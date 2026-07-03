/**
 * DemoForge renderer — stability detection.
 *
 * Renders a script N times, compares outputs, and selects the most stable
 * render. Addresses the risk of animated/nondeterministic UIs (PRD Risk #4).
 */

import type { RenderResult } from './types.js';

export interface StabilityResult {
  /** Index of the most stable render attempt. */
  stableIndex: number;
  /** The most stable render result. */
  stableResult: RenderResult;
  /** All render results for inspection. */
  allResults: RenderResult[];
  /** All screenshots for comparison. */
  screenshots: Buffer[];
}

/**
 * Detect stability across multiple render attempts.
 *
 * Renders are compared by their screenshot buffers. The most stable render
 * is the one whose screenshot appears most frequently. If all renders differ,
 * the first one is selected.
 *
 * @param results - Render results from N attempts
 * @param screenshots - Screenshot buffers from each attempt
 * @returns Stability analysis result
 */
export function stabilityDetect(
  results: RenderResult[],
  screenshots: Buffer[],
): StabilityResult {
  if (results.length === 0) {
    return {
      stableIndex: 0,
      stableResult: {
        steps: [],
        totalDuration: 0,
        status: 'success',
        stepCount: 0,
        warnings: [],
      },
      allResults: [],
      screenshots: [],
    };
  }

  if (results.length === 1) {
    return {
      stableIndex: 0,
      stableResult: results[0]!,
      allResults: results,
      screenshots,
    };
  }

  // Find the most common screenshot
  const frequencyMap = new Map<string, number>();
  const screenshotIndices = new Map<string, number>();

  for (let i = 0; i < screenshots.length; i++) {
    const key = screenshots[i]!.toString('base64');
    const count = (frequencyMap.get(key) ?? 0) + 1;
    frequencyMap.set(key, count);
    if (!screenshotIndices.has(key)) {
      screenshotIndices.set(key, i);
    }
  }

  // Find the screenshot with the highest frequency
  let maxCount = 0;
  let mostCommonKey = '';
  for (const [key, count] of frequencyMap) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonKey = key;
    }
  }

  const stableIndex = screenshotIndices.get(mostCommonKey) ?? 0;
  const stableResult = results[stableIndex] ?? results[0] ?? {
    steps: [],
    totalDuration: 0,
    status: 'success',
    stepCount: 0,
    warnings: [],
  };

  return {
    stableIndex,
    stableResult,
    allResults: results,
    screenshots,
  };
}
