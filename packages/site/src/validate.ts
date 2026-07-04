/**
 * DemoForge site generator — asset validation.
 *
 * Validates that referenced videos, images, and thumbnails exist
 * and are valid (not corrupted).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FlowInfo, AssetValidationResult } from "./site-generator.js";

export function validateAssets(flows: FlowInfo[]): AssetValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let totalVideos = 0;
  let totalScreenshots = 0;

  for (const flow of flows) {
    // Validate video files
    if (flow.videoFiles) {
      for (const [format, path] of Object.entries(flow.videoFiles)) {
        if (!path) continue;
        totalVideos++;
        if (!existsSync(path)) {
          errors.push(`[${flow.name}] Missing video file: ${format} (${path})`);
        } else {
          try {
            const stats = statSync(path);
            if (stats.size === 0) {
              errors.push(`[${flow.name}] Empty video file: ${format} (${path})`);
            } else if (format === "mp4" || format === "webm") {
              const data = readFileSync(path);
              if (data.length < 8) {
                warnings.push(`[${flow.name}] Video file may be corrupt (too short): ${path}`);
              }
            } else if (format === "gif") {
              const data = readFileSync(path);
              if (data.length >= 3 && !(data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46)) {
                warnings.push(`[${flow.name}] GIF file has invalid header: ${path}`);
              }
            } else if (format === "webp") {
              const data = readFileSync(path);
              if (data.length >= 12) {
                const isWebP = data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
                if (!isWebP) {
                  warnings.push(`[${flow.name}] WebP file may have invalid header: ${path}`);
                }
              }
            }
          } catch {
            warnings.push(`[${flow.name}] Cannot read video file: ${path}`);
          }
        }
      }
    }

    // Validate screenshots
    if (flow.screenshotFiles) {
      for (const path of flow.screenshotFiles) {
        if (!path) continue;
        totalScreenshots++;
        if (!existsSync(path)) {
          warnings.push(`[${flow.name}] Missing screenshot: ${path}`);
        } else {
          try {
            const stats = statSync(path);
            if (stats.size === 0) {
              warnings.push(`[${flow.name}] Empty screenshot: ${path}`);
            } else {
              const data = readFileSync(path);
              if (data.length >= 8) {
                const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
                const isJpg = data[0] === 0xff && data[1] === 0xd8;
                const isGif = data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46;
                if (!isPng && !isJpg && !isGif) {
                  warnings.push(`[${flow.name}] Screenshot may have invalid image header: ${path}`);
                }
              }
            }
          } catch {
            warnings.push(`[${flow.name}] Cannot read screenshot: ${path}`);
          }
        }
      }
    }

    // Validate thumbnail
    if (flow.thumbnail) {
      const thumbPath = join(flow.outputDir, flow.thumbnail);
      if (!existsSync(thumbPath)) {
        warnings.push(`[${flow.name}] Missing thumbnail: ${thumbPath}`);
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    totalFlows: flows.length,
    totalVideos,
    totalScreenshots,
  };
}
