/**
 * DemoForge renderer — burned-in captions via ffmpeg.
 *
 * Uses ffmpeg to overlay captions onto video frames. Supports two approaches:
 * 1. subtitles filter with SRT input (styled burned-in captions)
 * 2. Subtitle muxer (native subtitle stream embedding)
 */

import { spawn } from 'node:child_process';

import type { BurnedInCaptionOptions, SubtitleFilterOutput, ProgressCallback } from './types.js';

/** Escape a file path for use inside an ffmpeg filter graph (\ : ' , ; [ ]). */
function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

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
   * Burn captions into video using the subtitles filter.
   * This renders the SRT captions as styled text directly on video frames.
   */
  async burnIn(options: BurnedInCaptionOptions): Promise<{ success: true; outputPath: string } | { success: false; error: string; stderr?: string }> {
    const { inputPath, outputPath, srtPath } = options;

    const finalOutput = outputPath || srtPath.replace(/\.srt$/, '_burned.mp4');
    const filterOutput = this.buildFilter(inputPath, srtPath, finalOutput);

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
   * Build ffmpeg arguments for burned-in captions using the subtitles filter.
   * The SRT file is consumed by the filter itself (not as a second input).
   */
  buildFilter(inputPath: string, srtPath: string, outputPath?: string): SubtitleFilterOutput {
    const out = outputPath ?? srtPath.replace(/\.srt$/, '_burned.mp4');
    const escapedSrt = escapeFilterPath(srtPath);
    // ASS force_style: white text, black outline, semi-transparent box
    const forceStyle = 'FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,BorderStyle=3,BackColour=&H55000000,Alignment=2';
    const filterArg = `[0:v]subtitles=filename=${escapedSrt}:force_style='${forceStyle}'[text]`;

    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-filter_complex', filterArg,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-map', '[text]',
      '-map', '0:a?',
      out,
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
