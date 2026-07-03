/**
 * DemoForge renderer — caption type definitions.
 *
 * Types for caption generation, styling, timing, and burned-in overlay.
 */

// ─── Caption styling ──────────────────────────────────────────────────────────

export interface CaptionStyle {
  /** Font family (e.g., 'Arial', 'Helvetica', 'sans-serif'). Default: 'Arial'. */
  fontFamily?: string;
  /** Font size in pixels. Default: 24. */
  fontSize?: number;
  /** Font color in hex (e.g., '#FFFFFF'). Default: '#FFFFFF'. */
  fontColor?: string;
  /** Background color in hex (e.g., '#00000080'). Default: '#00000080' (semi-transparent black). */
  backgroundColor?: string;
  /** Horizontal position: 'left', 'center', 'right'. Default: 'center'. */
  horizontalAlign?: 'left' | 'center' | 'right';
  /** Vertical position: 'top', 'middle', 'bottom', or percentage (e.g., '80%'). Default: 'bottom'. */
  verticalAlign?: 'top' | 'middle' | 'bottom' | string;
  /** Border style: 'none', 'box', 'outline'. Default: 'box'. */
  borderStyle?: 'none' | 'box' | 'outline';
  /** Border color in hex. Default: '#000000'. */
  borderColor?: string;
  /** Border width in pixels. Default: 2. */
  borderWidth?: number;
}

export interface DefaultCaptionStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontColor: string;
  readonly backgroundColor: string;
  readonly horizontalAlign: 'left' | 'center' | 'right';
  readonly verticalAlign: 'top' | 'middle' | 'bottom' | string;
  readonly borderStyle: 'none' | 'box' | 'outline';
  readonly borderColor: string;
  readonly borderWidth: number;
}

// ─── Caption entry ─────────────────────────────────────────────────────────────

export interface CaptionEntry {
  /** Sequential number (1-based). */
  index: number;
  /** Caption text. */
  text: string;
  /** Start time in milliseconds. */
  startTime: number;
  /** Duration in milliseconds. */
  duration: number;
  /** Optional label/source identifier (e.g., 'narrate', 'tts', 'narrate-step-3'). */
  source?: string;
}

// ─── Burned-in caption options ────────────────────────────────────────────────

export interface BurnedInCaptionOptions {
  /** Path to the input video file. */
  inputPath: string;
  /** Path to the output video file with burned-in captions. */
  outputPath: string;
  /** Path to the SRT file to burn in. */
  srtPath: string;
  /** ffmpeg binary path. Default: 'ffmpeg'. */
  ffmpegPath?: string;
  /** Whether to keep the original video. Default: true. */
  keepOriginal?: boolean;
}

// ─── Caption generation result ────────────────────────────────────────────────

export interface CaptionGenerationResult {
  /** SRT file path. */
  srtPath: string;
  /** VTT file path. */
  vttPath?: string;
  /** Whether generation succeeded. */
  success: boolean;
  /** Error message if failed. */
  error?: string;
  /** Number of captions generated. */
  captionCount: number;
}

// ─── Caption file format ──────────────────────────────────────────────────────

export type CaptionFormat = 'srt' | 'vtt';

// ─── FFmpeg subtitle filter output ────────────────────────────────────────────

export interface SubtitleFilterOutput {
  /** The -vf / -filter:v argument for burned-in subtitles. */
  filterArg: string;
  /** Full ffmpeg args array (input + subtitle + output). */
  ffmpegArgs: string[];
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export type ProgressPhase = 'encoding' | 'burning';

export interface ProgressUpdate {
  phase: ProgressPhase;
  percent: number;
  message: string;
}

export type ProgressCallback = (update: ProgressUpdate) => void;
