/**
 * DemoForge renderer — TTS engine type definitions.
 */

// ─── Backend interface ────────────────────────────────────────────────────────

/**
 * Pluggable TTS backend interface.
 * Each backend implements this contract to synthesize speech from text.
 */
export interface TtsBackend {
  /** Synthesize speech from text. Returns audio buffer and timing info. */
  synthesize(text: string, options: BackendSynthesizeOptions): Promise<SynthesisResult>;

  /** Check if the backend is available (model files exist, binary is present). */
  isAvailable(): Promise<boolean>;

  /** Get the backend name. */
  getName(): string;
}

export interface BackendSynthesizeOptions {
  voice?: string;
  speed?: number;
  format?: AudioFormat;
}

export interface SynthesisResult {
  /** Raw audio data (PCM WAV bytes). */
  audio: Buffer;
  /** Estimated or actual duration in milliseconds. */
  durationMs: number;
  /** The text that was synthesized. */
  text: string;
}

// ─── Audio format ─────────────────────────────────────────────────────────────

export type AudioFormat = 'wav' | 'mp3' | 'opus';

// ─── TTS configuration ────────────────────────────────────────────────────────

export type TtsBackendName = 'piper' | 'kokoro' | 'openai';

export type AudioOutputMode = 'embedded' | 'sidecar';

export type FallbackMode = 'captions-only' | 'silent';

export interface OpenAiTtsConfig {
  /** OpenAI-compatible API key. */
  apiKey: string;
  /** Base URL of the OpenAI-compatible TTS endpoint. */
  baseUrl: string;
  /** TTS model name (e.g., 'tts-1', 'tts-1-hd'). */
  model: string;
}

export interface TtsConfig {
  /** Whether TTS is enabled. Default: false (opt-in). */
  enabled?: boolean;
  /** TTS backend to use. Default: 'piper'. */
  backend?: TtsBackendName;
  /** Voice ID to use (backend-specific). */
  voice?: string;
  /** Speech rate multiplier (1.0 = normal). */
  speechRate?: number;
  /** Audio output format. Default: 'wav'. */
  format?: AudioFormat;
  /** Audio output mode. 'embedded' for video embedding, 'sidecar' for separate file. */
  audioOutput?: AudioOutputMode;
  /** Output directory for sidecar audio files. */
  outputDir?: string;
  /** Target duration in ms for timing alignment. When set, audio is padded/truncated. */
  targetDurationMs?: number;
  /** Fallback mode when TTS is unavailable. */
  fallbackMode?: FallbackMode;
  /** OpenAI-compatible backend config. */
  openai?: OpenAiTtsConfig;
  /** Piper model path (optional, auto-detected if not set). */
  piperModelPath?: string;
  /** Kokoro model path (optional, auto-detected if not set). */
  kokoroModelPath?: string;
}

// ─── Synthesis result (public API) ────────────────────────────────────────────

export interface TtsSynthesisResult {
  /** Raw audio data. Empty when TTS is disabled or in fallback mode. */
  audio?: Buffer;
  /** Duration in milliseconds. */
  durationMs: number;
  /** The text that was synthesized. */
  text: string;
  /** Whether captions-only fallback was used. */
  fallback: boolean;
  /** Backend name that was used. */
  backend: string;
  /** Sidecar audio file path (when audioOutput is 'sidecar'). */
  sidecarPath?: string;
  /** License file path (when license generation is enabled). */
  licensePath?: string;
}
