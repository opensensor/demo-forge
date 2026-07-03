/**
 * DemoForge renderer — audio module.
 */

export * as tts from './tts/index.js';
export { TtsEngine } from './tts/engine.js';
export { PiperBackend } from './tts/backends/piper.js';
export { KokoroBackend } from './tts/backends/kokoro.js';
export { OpenAiBackend } from './tts/backends/openai.js';
export { generateLicenseFile, verifyModelSource } from './tts/license.js';

export * as captions from './captions/index.js';
export { CaptionGenerator } from './captions/generator.js';
export { BurnedInCaptions } from './captions/burned-in.js';
export { SidecarCaptionWriter } from './captions/sidecar-writer.js';

export type {
  TtsBackend,
  BackendSynthesizeOptions,
  SynthesisResult,
  AudioFormat,
  TtsBackendName,
  AudioOutputMode,
  FallbackMode,
  OpenAiTtsConfig,
  TtsConfig,
  TtsSynthesisResult,
} from './tts/types.js';

export type {
  CaptionStyle,
  DefaultCaptionStyle,
  CaptionEntry,
  BurnedInCaptionOptions,
  CaptionGenerationResult,
  CaptionFormat,
  SubtitleFilterOutput,
} from './captions/types.js';
