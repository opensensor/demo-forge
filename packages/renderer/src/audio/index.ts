/**
 * DemoForge renderer — audio module.
 */

export * as tts from './tts/index.js';
export { TtsEngine } from './tts/engine.js';
export { PiperBackend } from './tts/backends/piper.js';
export { KokoroBackend } from './tts/backends/kokoro.js';
export { OpenAiBackend } from './tts/backends/openai.js';
export { generateLicenseFile, verifyModelSource } from './tts/license.js';

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
