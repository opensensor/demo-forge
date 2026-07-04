/**
 * DemoForge renderer — capture pipeline type definitions.
 *
 * ffmpeg orchestration for final asset production: H.264/MP4, VP9/AV1/WebM,
 * GIF with palette, animated WebP, output metadata, progress reporting,
 * and quality presets.
 */

// ─── Quality Presets ─────────────────────────────────────────────────────────

export type QualityPreset = 'max' | 'balanced' | 'small';

export interface QualityPresetConfig {
  /** H.264 CRF value (lower = better quality, 0-51). */
  crf: number;
  /** H.264 preset (slower = better compression). */
  x264Preset: string;
  /** VP9 quality level (0-63, lower = better). */
  vp9Quality: number;
  /** AV1 CRF value (0-63, lower = better). */
  av1Crf: number;
  /** GIF palette quality (1-10, higher = better). */
  paletteQuality: number;
  /** GIF max frames for palette generation. */
  paletteMaxFrames: number;
  /** WebP compression method (0-6, higher = better compression). */
  webpCompression: number;
  /** WebP quality (0-100). */
  webpQuality: number;
}

// ─── Encoding Options ────────────────────────────────────────────────────────

export interface BaseEncodingOptions {
  /** Target width in pixels. Defaults to input width. */
  width?: number;
  /** Target height in pixels. Defaults to input height. */
  height?: number;
  /** Target frame rate. Defaults to input fps. */
  fps?: number;
  /** Limit encoder worker threads. Useful on desktop machines already running LLM/GPU workloads. */
  threads?: number;
  /** Quality preset. Default: 'balanced'. */
  quality?: QualityPreset;
  /** Explicit output file path. Default: a timestamped file in tmpDir. */
  outputPath?: string;
}

export interface Mp4EncodingOptions extends BaseEncodingOptions {
  format: 'mp4';
  /** H.264 profile. Default: 'high'. */
  profile?: 'baseline' | 'main' | 'high';
  /** H.264 level. Default: '4.2'. */
  level?: string;
}

export interface WebmEncodingOptions extends BaseEncodingOptions {
  format: 'webm';
  /** Codec to use: 'vp9' or 'av1'. Default: 'vp9'. */
  codec?: 'vp9' | 'av1';
}

export interface GifEncodingOptions extends BaseEncodingOptions {
  format: 'gif';
  /** Maximum file size in bytes. Default: 5 * 1024 * 1024 (5 MB). */
  maxSizeBytes?: number;
  /** Whether to auto-reduce fps/scale to meet size budget. Default: true. */
  autoReduce?: boolean;
}

export interface WebpEncodingOptions extends BaseEncodingOptions {
  format: 'webp';
  /** Animation loop count (0 = infinite). Default: 0. */
  loop?: number;
}

export type EncodingOptions =
  | Mp4EncodingOptions
  | WebmEncodingOptions
  | GifEncodingOptions
  | WebpEncodingOptions;

// ─── Output Metadata ─────────────────────────────────────────────────────────

export interface OutputMetadata {
  /** Output file path. */
  outputPath: string;
  /** Output file size in bytes. */
  fileSize: number;
  /** Video width in pixels. */
  width: number;
  /** Video height in pixels. */
  height: number;
  /** Duration in seconds. */
  duration: number;
  /** Frame rate. */
  fps: number;
  /** Video codec name (e.g., 'h264', 'vp9', 'av1'). */
  codec: string;
  /** Output format (e.g., 'mp4', 'webm', 'gif', 'webp'). */
  format: string;
  /** Number of frames (0 for non-video formats). */
  frameCount: number;
}

// ─── Progress ────────────────────────────────────────────────────────────────

export type ProgressPhase =
  | 'scaling'
  | 'palette_generation'
  | 'encoding'
  | 'finalizing';

export interface ProgressUpdate {
  /** Current phase of the encoding pipeline. */
  phase: ProgressPhase;
  /** Percentage complete (0-100). */
  percent: number;
  /** Human-readable status message. */
  message: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// ─── Render Result ───────────────────────────────────────────────────────────

export interface CaptureResult {
  /** Encoding succeeded. */
  success: true;
  /** Output metadata for the produced asset. */
  metadata: OutputMetadata;
  /** Warnings produced during encoding. */
  warnings: string[];
}

export interface CaptureFailure {
  /** Encoding failed. */
  success: false;
  /** Error message. */
  error: string;
  /** ffmpeg stderr output for debugging. */
  stderr?: string;
}

export type CaptureResultUnion = CaptureResult | CaptureFailure;

// ─── Pipeline Config ─────────────────────────────────────────────────────────

export interface CapturePipelineConfig {
  /** ffmpeg binary path. Default: 'ffmpeg'. */
  ffmpegPath?: string;
  /** ffprobe binary path. Default: 'ffprobe'. */
  ffprobePath?: string;
  /** Working directory for temporary files. */
  tmpDir?: string;
  /** Progress callback. */
  onProgress?: ProgressCallback;
  /** Timeout for encoding in milliseconds. Default: 300000 (5 min). */
  timeout?: number;
}
