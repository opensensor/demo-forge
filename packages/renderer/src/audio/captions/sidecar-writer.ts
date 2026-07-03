/**
 * DemoForge renderer — sidecar caption file writer.
 *
 * Writes SRT and VTT caption files alongside video output.
 * Aligns caption timing with TTS narration or narrate step pauses.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CaptionEntry, CaptionStyle, CaptionGenerationResult } from './types.js';
import { CaptionGenerator } from './generator.js';

// ─── Default output directory ─────────────────────────────────────────────────

const DEFAULT_OUTPUT_DIR = 'output';

// ─── SidecarCaptionWriter ─────────────────────────────────────────────────────

export class SidecarCaptionWriter {
  private outputDir: string;
  private style: Partial<CaptionStyle>;

  constructor(options?: { outputDir?: string; style?: Partial<CaptionStyle> }) {
    this.outputDir = options?.outputDir ?? DEFAULT_OUTPUT_DIR;
    this.style = options?.style ?? {};
  }

  /**
   * Write sidecar caption files for a video output.
   *
   * @param entries - Caption entries with timing info.
   * @param videoBaseName - Base name for the video (used for caption file naming).
   * @returns CaptionGenerationResult with paths to generated files.
   */
  write(entries: CaptionEntry[], videoBaseName?: string): CaptionGenerationResult {
    const baseName = videoBaseName ?? 'captions';
    const gen = new CaptionGenerator({
      style: this.style,
      outputDir: this.outputDir,
    });

    gen.addEntries(entries);

    const srtPath = path.join(this.outputDir, `${baseName}.srt`);
    const vttPath = path.join(this.outputDir, `${baseName}.vtt`);

    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(srtPath, gen.generateSrt(), 'utf-8');
    fs.writeFileSync(vttPath, gen.generateVtt(), 'utf-8');

    return {
      success: true,
      srtPath,
      vttPath,
      captionCount: entries.length,
    };
  }

  /**
   * Generate caption entries from TTS results.
   *
   * Aligns caption timing with TTS narration durations.
   *
   * @param ttsResults - Array of TTS synthesis results with timing.
   * @param startTime - Starting timestamp offset (ms).
   * @returns CaptionEntry array aligned with TTS timing.
   */
  static entriesFromTtsResults(
    ttsResults: Array<{ text: string; durationMs: number; fallback?: boolean }>,
    startTime: number = 0,
  ): CaptionEntry[] {
    const entries: CaptionEntry[] = [];
    let currentTime = startTime;

    for (let i = 0; i < ttsResults.length; i++) {
      const result = ttsResults[i]!;
      if (!result.text || result.text.trim().length === 0) {
        continue;
      }

      entries.push({
        index: i + 1,
        text: result.text,
        startTime: currentTime,
        duration: result.durationMs,
        source: result.fallback ? 'fallback' : 'tts',
      });

      currentTime += result.durationMs;
    }

    return entries;
  }

  /**
   * Generate caption entries from narrate step pauses.
   *
   * Uses the step index and pause duration for timing.
   *
   * @param narrateSteps - Array of narrate step data with text and duration.
   * @param startTime - Starting timestamp offset (ms).
   * @returns CaptionEntry array aligned with narrate step timing.
   */
  static entriesFromNarrateSteps(
    narrateSteps: Array<{ text: string; duration: number }>,
    startTime: number = 0,
  ): CaptionEntry[] {
    const entries: CaptionEntry[] = [];
    let currentTime = startTime;

    for (let i = 0; i < narrateSteps.length; i++) {
      const step = narrateSteps[i]!;
      if (!step.text || step.text.trim().length === 0) {
        continue;
      }

      entries.push({
        index: i + 1,
        text: step.text,
        startTime: currentTime,
        duration: step.duration,
        source: `narrate-step-${i + 1}`,
      });

      currentTime += step.duration;
    }

    return entries;
  }
}
