/**
 * DemoForge renderer — ffmpeg encoding pipeline.
 *
 * CapturePipeline orchestrates ffmpeg encoding for final asset production:
 * H.264/MP4, VP9/AV1/WebM, GIF with palette, animated WebP.
 * Supports quality presets, size budget enforcement, progress reporting,
 * and output metadata extraction.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { copyFile, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import type {
  CapturePipelineConfig,
  EncodingOptions,
  Mp4EncodingOptions,
  WebmEncodingOptions,
  GifEncodingOptions,
  WebpEncodingOptions,
  OutputMetadata,
  ProgressUpdate,
  CaptureResult,
  CaptureFailure,
  CaptureResultUnion,
  QualityPresetConfig,
  ProgressCallback,
  QualityPreset,
  ProgressPhase,
} from './types.js';

// ─── Quality Presets ─────────────────────────────────────────────────────────

const QUALITY_PRESETS: Record<string, QualityPresetConfig> = {
  max: {
    crf: 18,
    x264Preset: 'slow',
    vp9Quality: 10,
    av1Crf: 22,
    paletteQuality: 9,
    paletteMaxFrames: 1000,
    webpCompression: 4,
    webpQuality: 95,
  },
  balanced: {
    crf: 23,
    x264Preset: 'medium',
    vp9Quality: 20,
    av1Crf: 32,
    paletteQuality: 7,
    paletteMaxFrames: 500,
    webpCompression: 2,
    webpQuality: 80,
  },
  small: {
    crf: 28,
    x264Preset: 'fast',
    vp9Quality: 30,
    av1Crf: 40,
    paletteQuality: 5,
    paletteMaxFrames: 200,
    webpCompression: 5,
    webpQuality: 60,
  },
};

// ─── CapturePipeline ─────────────────────────────────────────────────────────

/**
 * ffmpeg scale filter for a target size. With both dimensions the frame is
 * letterboxed to exactly that size; with one, the other follows the aspect
 * ratio (rounded to an even number, which most codecs require).
 */
function scaleFilterFor(width?: number, height?: number): string {
  if (width && height) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  }
  return `scale=${width ?? -2}:${height ?? -2}:flags=lanczos`;
}

export class CapturePipeline {
  private _ffmpegPath: string;
  private _ffprobePath: string;
  private _tmpDir: string;
  private _onProgress?: ProgressCallback;
  private _timeout: number;

  constructor(config?: CapturePipelineConfig) {
    this._ffmpegPath = config?.ffmpegPath ?? 'ffmpeg';
    this._ffprobePath = config?.ffprobePath ?? 'ffprobe';
    this._tmpDir = config?.tmpDir ?? tmpdir();
    this._onProgress = config?.onProgress;
    this._timeout = config?.timeout ?? 300000;
  }

  /**
   * Encode an input video file to the specified format.
   *
   * @param inputPath — Path to the source video (WebM/MP4 from browser capture).
   * @param options — Encoding options for the target format.
   * @returns CaptureResult with metadata on success, or CaptureFailure on error.
   */
  async encode(
    inputPath: string,
    options: EncodingOptions,
  ): Promise<CaptureResultUnion> {
    const format = options.format;

    try {
      switch (format) {
        case 'mp4':
          return await this._encodeMp4(inputPath, options as Mp4EncodingOptions);
        case 'webm':
          return await this._encodeWebm(inputPath, options as WebmEncodingOptions);
        case 'gif':
          return await this._encodeGif(inputPath, options as GifEncodingOptions);
        case 'webp':
          return await this._encodeWebp(inputPath, options as WebpEncodingOptions);
        default:
          return {
            success: false,
            error: `Unsupported format: ${format}. Supported: mp4, webm, gif, webp`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Encoding failed: ${message}` };
    }
  }

  // ─── H.264 MP4 Encoding ────────────────────────────────────────────────

  private async _encodeMp4(
    inputPath: string,
    options: Mp4EncodingOptions,
  ): Promise<CaptureResultUnion> {
    const preset = this._getPreset(options);
    const outputPath = options.outputPath ?? join(this._tmpDir, `output_${Date.now()}.mp4`);

    const args = this._buildCommonArgs(inputPath, options);
    args.push('-c:v', 'libx264');
    args.push('-crf', String(preset.crf));
    args.push('-preset', preset.x264Preset);
    args.push('-pix_fmt', 'yuv420p');

    if (options.profile) {
      args.push('-profile:v', options.profile);
    }
    if (options.level) {
      args.push('-level', options.level);
    }

    // Copy audio if present
    args.push('-c:a', 'aac', '-b:a', '128k');
    args.push(outputPath);

    const result = await this._runFfmpeg(args, outputPath);
    if (!result.success) return result;

    return {
      success: true,
      metadata: {
        outputPath,
        fileSize: result.fileSize,
        width: options.width ?? result.width,
        height: options.height ?? result.height,
        duration: result.duration,
        fps: options.fps ?? result.fps,
        codec: 'h264',
        format: 'mp4',
        frameCount: result.frameCount,
      },
      warnings: result.warnings,
    };
  }

  // ─── VP9/AV1 WebM Encoding ─────────────────────────────────────────────

  private async _encodeWebm(
    inputPath: string,
    options: WebmEncodingOptions,
  ): Promise<CaptureResultUnion> {
    const preset = this._getPreset(options);
    const codec = options.codec ?? 'vp9';
    const ext = codec === 'av1' ? 'webm' : 'webm';
    const outputPath = options.outputPath ?? join(this._tmpDir, `output_${Date.now()}.${ext}`);

    const args = this._buildCommonArgs(inputPath, options);

    if (codec === 'vp9') {
      args.push('-c:v', 'libvpx-vp9');
      args.push('-crf', String(preset.vp9Quality));
      args.push('-b:v', '0');
      args.push('-cpu-used', '4');
    } else {
      args.push('-c:v', 'libsvtav1');
      args.push('-crf', String(preset.av1Crf));
    }

    // Copy audio if present
    args.push('-c:a', 'libvorbis');
    args.push(outputPath);

    const result = await this._runFfmpeg(args, outputPath);
    if (!result.success) return result;

    return {
      success: true,
      metadata: {
        outputPath,
        fileSize: result.fileSize,
        width: options.width ?? result.width,
        height: options.height ?? result.height,
        duration: result.duration,
        fps: options.fps ?? result.fps,
        codec,
        format: 'webm',
        frameCount: result.frameCount,
      },
      warnings: result.warnings,
    };
  }

  // ─── GIF Encoding with Palette ─────────────────────────────────────────

  private async _encodeGif(
    inputPath: string,
    options: GifEncodingOptions,
  ): Promise<CaptureResultUnion> {
    const maxSizeBytes = options.maxSizeBytes ?? 5 * 1024 * 1024; // 5 MB default
    const outputPath = options.outputPath ?? join(this._tmpDir, `output_${Date.now()}.gif`);
    const targetFps = options.fps ?? 10;
    const needsScale = options.width !== undefined || options.height !== undefined;

    this._reportProgress({
      phase: 'palette_generation',
      percent: 0,
      message: 'Generating color palette...',
    });

    // Build scale filter portion conditionally
    const scaleFilter = needsScale ? `${scaleFilterFor(options.width, options.height)},` : '';

    // Single-pass palette-based GIF encoding using split/palettegen/paletteuse
    const filterComplex = `[0:v]fps=${targetFps},${scaleFilter}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`;

    const gifArgs: string[] = [
      '-y',
      '-nostdin',
      '-i', inputPath,
      '-filter_complex', filterComplex,
      '-loop', '0',
    ];
    this._appendThreadLimit(gifArgs, options);
    gifArgs.push(outputPath);

    const result = await this._runFfmpegWithCapture(gifArgs, outputPath);

    if (!result.success) return result;

    // Enforce size budget
    let finalPath = outputPath;
    let finalFileSize = result.fileSize;
    const warnings: string[] = [...result.warnings];

    if (finalFileSize > maxSizeBytes && options.autoReduce !== false) {
      warnings.push(
        `GIF size ${finalFileSize} bytes exceeds budget ${maxSizeBytes} bytes, auto-reducing quality...`,
      );
      const reducedPath = await this._autoReduceGif(
        inputPath,
        options,
        maxSizeBytes,
        warnings,
      );
      if (reducedPath) {
        await rename(reducedPath, outputPath).catch(() => copyFile(reducedPath, outputPath));
        finalPath = outputPath;
        const reducedStat = await stat(finalPath).catch(() => null);
        finalFileSize = reducedStat?.size ?? finalFileSize;
      } else {
        warnings.push('Could not auto-reduce GIF to meet size budget, keeping original');
      }
    }

    this._reportProgress({
      phase: 'encoding',
      percent: 100,
      message: 'GIF encoding complete',
    });

    return {
      success: true,
      metadata: {
        outputPath: finalPath,
        fileSize: finalFileSize,
        width: options.width ?? result.width,
        height: options.height ?? result.height,
        duration: result.duration,
        fps: options.fps ?? result.fps,
        codec: 'gif',
        format: 'gif',
        frameCount: result.frameCount,
      },
      warnings,
    };
  }

  /**
   * Auto-reduce GIF quality to meet size budget.
   * Reduces resolution and fps iteratively.
   * Returns null if no attempt produced a GIF within the budget.
   */
  private async _autoReduceGif(
    inputPath: string,
    options: GifEncodingOptions,
    maxSizeBytes: number,
    warnings: string[],
  ): Promise<string | null> {
    let scale = options.width ?? 320;
    let fps = options.fps ?? 10;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;
      const outputPath = join(this._tmpDir, `gif_reduced_${Date.now()}_${attempts}.gif`);

      // Reduce scale and fps for next attempt
      if (attempts > 1) {
        scale = Math.max(160, Math.round(scale * 0.75));
        fps = Math.max(5, Math.round(fps * 0.75));
      }

      const scaleFilter = `${scaleFilterFor(scale, options.height ? Math.round((options.height * scale) / (options.width ?? scale)) : undefined)},`;
      const filterComplex = `[0:v]fps=${fps},${scaleFilter}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`;

      const gifArgs: string[] = [
        '-y',
        '-nostdin',
        '-i', inputPath,
        '-filter_complex', filterComplex,
        '-loop', '0',
      ];
      this._appendThreadLimit(gifArgs, options);
      gifArgs.push(outputPath);

      const result = await this._runFfmpegWithCapture(gifArgs, outputPath);

      if (!result.success) continue;

      if (result.fileSize <= maxSizeBytes) {
        warnings.push(
          `GIF auto-reduced to width ${scale} @ ${fps}fps (${result.fileSize} bytes) to meet ${maxSizeBytes} byte budget`,
        );
        return outputPath;
      }
    }

    return null;
  }

  // ─── Animated WebP Encoding ────────────────────────────────────────────

  private async _encodeWebp(
    inputPath: string,
    options: WebpEncodingOptions,
  ): Promise<CaptureResultUnion> {
    const preset = this._getPreset(options);
    const outputPath = options.outputPath ?? join(this._tmpDir, `output_${Date.now()}.webp`);

    const loop = options.loop ?? 0;

    const args = this._buildCommonArgs(inputPath, options);
    args.push('-c:v', 'libwebp');
    args.push('-lossless', '0');
    args.push('-quality', String(preset.webpQuality));
    args.push('-compression_level', String(preset.webpCompression));
    args.push('-loop', String(loop));
    args.push(outputPath);

    const result = await this._runFfmpeg(args, outputPath);
    if (!result.success) return result;

    return {
      success: true,
      metadata: {
        outputPath,
        fileSize: result.fileSize,
        width: options.width ?? result.width,
        height: options.height ?? result.height,
        duration: result.duration,
        fps: options.fps ?? result.fps,
        codec: 'webp',
        format: 'webp',
        frameCount: result.frameCount,
      },
      warnings: result.warnings,
    };
  }

  // ─── Common Argument Building ──────────────────────────────────────────

  private _buildCommonArgs(
    inputPath: string,
    options: EncodingOptions,
  ): string[] {
    const args: string[] = [
      '-y', // Overwrite output
      '-nostdin',
      '-i', inputPath,
    ];

    this._appendThreadLimit(args, options);

    // Scale to target resolution
    if (options.width || options.height) {
      args.push('-vf', scaleFilterFor(options.width, options.height));
    }

    // Apply target fps
    if (options.fps) {
      args.push('-r', String(options.fps));
    }

    return args;
  }

  private _appendThreadLimit(args: string[], options: EncodingOptions): void {
    if (options.threads !== undefined && Number.isFinite(options.threads) && options.threads > 0) {
      args.push('-threads', String(Math.floor(options.threads)));
    }
  }

  // ─── FFmpeg Execution ──────────────────────────────────────────────────

  private async _runFfmpeg(
    args: string[],
    outputPath: string,
  ): Promise<{
    success: true;
    fileSize: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
    frameCount: number;
    warnings: string[];
  } | { success: false; error: string; stderr?: string }> {
    return this._runFfmpegWithCapture(args, outputPath);
  }

  private async _runFfmpegWithCapture(
    args: string[],
    outputPath: string,
  ): Promise<{
    success: true;
    fileSize: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
    frameCount: number;
    warnings: string[];
  } | { success: false; error: string; stderr?: string }> {
    return new Promise((resolve) => {
      const process = spawn(this._ffmpegPath, args, {
        timeout: this._timeout,
      });

      let stderr = '';
      const warnings: string[] = [];

      process.stdout?.on('data', () => {
        // Drain stdout so the child process does not block; output is unused.
      });

      process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this._parseFfmpegProgress(text);
        // Capture warnings from ffmpeg output
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('warning')) {
            warnings.push(line.trim());
          }
        }
      });

      process.on('close', async (code) => {
        if (code === 0) {
          try {
            const metadata = await this._probeFile(outputPath);
            resolve({
              success: true,
              fileSize: metadata.fileSize,
              width: metadata.width,
              height: metadata.height,
              duration: metadata.duration,
              fps: metadata.fps,
              frameCount: metadata.frameCount,
              warnings,
            });
          } catch {
            resolve({
              success: false,
              error: `ffmpeg succeeded but output file could not be read: ${outputPath}`,
            });
          }
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

  // ─── Progress Parsing ──────────────────────────────────────────────────

  private _parseFfmpegProgress(output: string): void {
    if (!this._onProgress) return;

    // Parse ffmpeg time output: time=00:00:15.23
    const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1] ?? '0', 10);
      const minutes = parseInt(timeMatch[2] ?? '0', 10);
      const seconds = parseFloat(timeMatch[3] ?? '0');
      const elapsed = hours * 3600 + minutes * 60 + seconds;

      // Estimate progress based on elapsed time vs 300s timeout
      const percent = Math.min(100, Math.round((elapsed / 300) * 100));
      this._reportProgress({
        phase: 'encoding',
        percent,
        message: `Encoding... ${elapsed.toFixed(1)}s elapsed`,
      });
    }
  }

  // ─── File Probing ──────────────────────────────────────────────────────

  private async _probeFile(
    filePath: string,
  ): Promise<{
    fileSize: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
    frameCount: number;
  }> {
    const probeTimeoutMs = 30000;
    const process = spawn(this._ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate',
      '-show_entries', 'format=duration',
      '-print_format', 'json',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (d: Buffer) => { stdout += d; });
    process.stderr?.on('data', (d: Buffer) => { stderr += d; });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        process.kill('SIGKILL');
        reject(new Error(`ffprobe timed out after ${probeTimeoutMs}ms probing ${filePath}`));
      }, probeTimeoutMs);

      process.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`ffprobe process error: ${err.message}. Ensure ffprobe is installed and in PATH.`));
      });

      process.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr || `ffprobe exited with code ${code}`));
      });
    });

    const probe = JSON.parse(stdout);
    const stream = probe.streams?.[0] ?? {};
    const format = probe.format ?? {};

    // Parse r_frame_rate (format: "30/1" or "30000/1001")
    let fps = 30;
    if (stream.r_frame_rate) {
      const [numStr, denStr] = stream.r_frame_rate.split('/');
      const num = parseInt(numStr, 10);
      const den = parseInt(denStr, 10) || 1;
      fps = Math.round(num / den);
    }

    const duration = parseFloat(String(format.duration)) || 0;

    // Estimate frame count from duration and fps
    const frameCount = duration > 0 ? Math.round(duration * fps) : 0;

    // Get file size
    const fileStat = await stat(filePath);

    return {
      fileSize: fileStat.size,
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      duration,
      fps,
      frameCount,
    };
  }

  // ─── Error Handling ────────────────────────────────────────────────────

  private _makeActionableError(stderr: string, args: string[]): string {
    const lower = stderr.toLowerCase();

    if (lower.includes('no such file') || lower.includes('no such file or directory')) {
      const iIndex = args.indexOf('-i');
      const input = iIndex >= 0 && iIndex + 1 < args.length ? args[iIndex + 1] : 'unknown';
      return `Input file not found: ${input}. Check that the file exists and the path is correct.`;
    }

    if (lower.includes('invalid data') || lower.includes('error')) {
      return `Invalid input file or corrupted media: ${stderr.trim().split('\n')[0]}. Verify the input file is a valid video.`;
    }

    if (lower.includes('permission denied')) {
      return `Permission denied. Check file/directory permissions for the input and output paths.`;
    }

    if (lower.includes('encoder not found') || lower.includes('codec')) {
      return `Codec not available. Ensure ffmpeg is compiled with the required codec support (libx264, libvpx-vp9, libsvtav1, libwebp).`;
    }

    return `ffmpeg encoding failed: ${stderr.trim().split('\n').slice(-3).join(' | ')}`;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private _getPreset(options: EncodingOptions): Required<QualityPresetConfig> {
    const presetName = options.quality ?? 'balanced';
    const preset = QUALITY_PRESETS[presetName];
    if (preset) return preset as Required<QualityPresetConfig>;
    return QUALITY_PRESETS['balanced'] as Required<QualityPresetConfig>;
  }

  private _reportProgress(update: ProgressUpdate): void {
    if (this._onProgress) {
      this._onProgress(update);
    }
  }
}

// Re-export types
export type {
  CapturePipelineConfig,
  EncodingOptions,
  Mp4EncodingOptions,
  WebmEncodingOptions,
  GifEncodingOptions,
  WebpEncodingOptions,
  OutputMetadata,
  ProgressUpdate,
  CaptureResult,
  CaptureFailure,
  CaptureResultUnion,
  QualityPreset,
  QualityPresetConfig,
  ProgressCallback,
  ProgressPhase,
};
