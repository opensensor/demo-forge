/**
 * DemoForge renderer — TTS engine module.
 *
 * Pluggable TTS engine with Piper (local, default), Kokoro (local, higher quality),
 * and OpenAI-compatible (cloud voices) backends.
 *
 * TTS is opt-in (disabled by default). Enable via config:
 *   new TtsEngine({ enabled: true, backend: 'piper' })
 */

export { TtsEngine } from './engine.js';
export { PiperBackend } from './backends/piper.js';
export { KokoroBackend } from './backends/kokoro.js';
export { OpenAiBackend } from './backends/openai.js';
export { generateLicenseFile, verifyModelSource } from './license.js';

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
} from './types.js';
