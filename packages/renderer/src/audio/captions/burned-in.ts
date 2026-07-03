/**
 * DemoForge renderer — burned-in captions via ffmpeg.
 *
 * Uses ffmpeg to overlay captions onto video frames. Supports two approaches:
 * 1. drawtext filter with SRT input (styled burned-in captions)
 * 2. Subtitle muxer (native subtitle stream embedding)
 */

import { spawn } from 'node:child_process';

import type { BurnedInCaptionOptions, SubtitleFilterOutput, ProgressCallback } from './types.js';

// ─── BurnedInCaptions ─────────────────────────────────────────────────────────

export class BurnedInCaptions {
  private ffmpegPath: string;
  private onProgress?: ProgressCallback;
  private timeout: number;

  constructor(options?: { ffmpegPath?: string; onProgress?: ProgressCallback; timeout?: number }) {
    this.ffmpegPath = options?.ffmpegPath ?? 'ffmpeg';
    this.onProgress = options?.onProgress;
    this.timeout = options?.timeout ?? 120000;
  }

  /**
   * Burn captions into video using the drawtext filter.
   * This renders the SRT captions as styled text directly on video frames.
   */
  async burnIn(options: BurnedInCaptionOptions): Promise<{ success: true; outputPath: string } | { success: false; error: string; stderr?: string }> {
    const { inputPath, outputPath, srtPath } = options;

    const filterOutput = this.buildFilter(inputPath, srtPath);
    const finalOutput = outputPath || filterOutput.ffmpegArgs[filterOutput.ffmpegArgs.length - 1]!;

    return this.runFfmpeg(filterOutput.ffmpegArgs, finalOutput);
  }

  /**
   * Burn captions using the subtitle muxer approach.
   * Embeds the SRT as a subtitle stream that the player renders.
   */
  async burnInWithMuxer(options: BurnedInCaptionOptions): Promise<{ success: true; outputPath: string } | { success: false; error: string; stderr?: string }> {
    const { inputPath, srtPath } = options;
    const outputPath = options.outputPath ?? srtPath.replace(/\.srt$/, '_subtitled.mp4');

    const muxerArgs = this.buildMuxerArgs(inputPath, srtPath, outputPath);

    return this.runFfmpeg(muxerArgs, outputPath);
  }

  /**
   * Build ffmpeg arguments for burned-in captions using drawtext filter.
   */
  buildFilter(inputPath: string, srtPath: string): SubtitleFilterOutput {
    const fontPath = this.resolveFontPath();
    const filterArg = `[0:v]drawtext=fontfile='${fontPath}':fontsize=24:fontcolor=WHITE:x=(w-text_w)/2:y=h-text_h-10:borderw=2:bordercolor=BLACK:box=1:boxcolor=0x000000AA@0.8[text]`;

    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-i', srtPath,
      '-filter_complex', filterArg,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-map', '[text]',
      '-map', '0:a?',
      srtPath.replace(/\.srt$/, '_burned.mp4'),
    ];

    return { filterArg, ffmpegArgs };
  }

  /**
   * Build ffmpeg arguments for subtitle muxer approach.
   */
  buildMuxerArgs(inputPath: string, srtPath: string, outputPath?: string): string[] {
    const out = outputPath || srtPath.replace(/\.srt$/, '_subtitled.mp4');

    return [
      '-y',
      '-i', inputPath,
      '-i', srtPath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
      '-c:s', 'mov_text',
      '-movflags', '+faststart',
      '-map', '0:v?',
      '-map', '0:a?',
      '-map', '1?',
      out,
    ];
  }

  // ─── Private methods ────────────────────────────────────────────────────

  private resolveFontPath(): string {
    // Try common system font paths
    const candidates = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/TTF/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/System/Library/Fonts/Helvetica.ttc',
      'C:/Windows/Fonts/arial.ttf',
    ];

    for (const candidate of candidates) {
      try {
        const fs = require('node:fs');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // Skip if font check fails
      }
    }

    // Return a fallback path (ffmpeg will use built-in font if not found)
    return '';
  }

  private async runFfmpeg(args: string[], outputPath: string): Promise<{ success: true; outputPath: string } | { success: false; error: string; stderr?: string }> {
    return new Promise((resolve) => {
      const process = spawn(this.ffmpegPath, args, {
        timeout: this.timeout,
      });

      let stderr = '';

      process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this._parseFfmpegProgress(text);
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, outputPath });
        } else {
          const actionable = this._makeActionableError(stderr, args);
          resolve({ success: false, error: actionable, stderr });
        }
      });

      process.on('error', (err) => {
        resolve({
          success: false,
          error: `ffmpeg process error: ${err.message}. Ensure ffmpeg is installed and in PATH.`,
        });
      });
    });
  }

  private _parseFfmpegProgress(output: string): void {
    if (!this.onProgress) return;

    const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1] ?? '0', 10);
      const minutes = parseInt(timeMatch[2] ?? '0', 10);
      const seconds = parseFloat(timeMatch[3] ?? '0');
      const elapsed = hours * 3600 + minutes * 60 + seconds;

      const percent = Math.min(100, Math.round((elapsed / 300) * 100));
      this.onProgress({
        phase: 'encoding',
        percent,
        message: `Burning captions... ${elapsed.toFixed(1)}s elapsed`,
      });
    }
  }

  private _makeActionableError(stderr: string, args: string[]): string {
    const lower = stderr.toLowerCase();

    if (lower.includes('no such file') || lower.includes('no such file or directory')) {
      const iIndex = args.indexOf('-i');
      const input = iIndex >= 0 && iIndex + 1 < args.length ? args[iIndex + 1] : 'unknown';
      return `Input file not found: ${input}. Check that the file exists and the path is correct.`;
    }

    if (lower.includes('encoder not found') || lower.includes('codec')) {
      return `Codec not available. Ensure ffmpeg is compiled with libx264 support.`;
    }

    return `Caption burning failed: ${stderr.trim().split('\n').slice(-3).join(' | ')}`;
  }
}
