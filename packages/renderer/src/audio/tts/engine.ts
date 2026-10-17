/**
 * DemoForge renderer — TTS engine.
 *
 * Orchestrates TTS synthesis for narrate steps in demo scripts.
 * Supports pluggable backends (Piper, Kokoro, OpenAI-compatible).
 * Handles timing alignment, licensing compliance, and captions-only fallback.
 *
 * TTS is opt-in: disabled by default, enabled via config.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  TtsConfig,
  TtsBackendName,
  TtsSynthesisResult,
} from './types.js';
import type { TtsBackend } from './types.js';

import { PiperBackend } from './backends/piper.js';
import { KokoroBackend } from './backends/kokoro.js';
import { OpenAiBackend } from './backends/openai.js';
import { ChatterboxBackend } from './backends/chatterbox.js';
import { generateLicenseFile, verifyModelSource } from './license.js';

// ─── Default speech rate (characters per second) ─────────────────────────────

const DEFAULT_CHARS_PER_SECOND = 4.5;

// ─── TtsEngine ───────────────────────────────────────────────────────────────

export class TtsEngine {
  private config: Required<
    Pick<TtsConfig, 'enabled' | 'backend' | 'voice' | 'speechRate' | 'format' | 'audioOutput' | 'fallbackMode'>
  > &
    Pick<TtsConfig, 'outputDir' | 'targetDurationMs' | 'openai' | 'piperModelPath' | 'kokoroModelPath'>;

  private backend?: TtsBackend;

  constructor(config?: TtsConfig) {
    if (!config) {
      throw new Error('TtsEngine requires a config object');
    }

    const backend = config.backend ?? 'piper';
    const validBackends: TtsBackendName[] = ['piper', 'kokoro', 'chatterbox', 'openai'];
    if (!validBackends.includes(backend)) {
      throw new Error(`Unknown TTS backend: ${backend}. Must be one of: ${validBackends.join(', ')}`);
    }

    this.config = {
      enabled: config.enabled ?? false,
      backend,
      voice: config.voice ?? '',
      speechRate: config.speechRate ?? 1.0,
      format: config.format ?? 'wav',
      audioOutput: config.audioOutput ?? 'embedded',
      outputDir: config.outputDir,
      targetDurationMs: config.targetDurationMs,
      fallbackMode: config.fallbackMode ?? 'captions-only',
      openai: config.openai,
      piperModelPath: config.piperModelPath,
      kokoroModelPath: config.kokoroModelPath,
    };

    // Initialize backend if enabled
    if (this.config.enabled) {
      this.backend = this.createBackend();
    }
  }

  /** Check if TTS is enabled (config flag). Use isReady() to check backend availability. */
  isEnabled(): boolean {
    return this.config.enabled && !!this.backend;
  }

  /** Check if TTS is enabled and the backend is available. */
  async isReady(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    if (!this.backend) {
      return false;
    }

    return this.backend.isAvailable();
  }

  /** Synthesize speech for a single narration text. */
  async synthesize(text: string): Promise<TtsSynthesisResult> {
    // Disabled engine returns empty result
    if (!this.config.enabled || !this.backend) {
      return {
        audio: Buffer.alloc(0),
        durationMs: 0,
        text,
        fallback: true,
        backend: this.config.backend,
      };
    }

    // Check backend availability
    const available = await this.isReady();
    if (!available) {
      return this.handleUnavailable(text);
    }

    // Verify model source (licensing compliance)
    this.verifyModelSource();

    try {
      const result = await this.backend.synthesize(text, {
        voice: this.config.voice,
        speed: this.config.speechRate,
        format: this.config.format,
      });

      // Apply timing alignment
      const aligned = this.alignTiming(result);

      // Handle audio output mode
      const sidecarPath = await this.saveAudio(aligned, text);

      // Generate license file
      const licensePath = this.generateLicense();

      return {
        audio: aligned.audio,
        durationMs: aligned.durationMs,
        text: aligned.text,
        fallback: false,
        backend: this.backend.getName(),
        sidecarPath,
        licensePath: licensePath ?? undefined,
      };
    } catch (error) {
      return this.handleSynthesisError(text, error);
    }
  }

  /** Get the current backend name. */
  getBackendName(): TtsBackendName {
    return this.config.backend;
  }

  // ─── Private methods ────────────────────────────────────────────────────

  private createBackend(): TtsBackend {
    switch (this.config.backend) {
      case 'piper':
        return new PiperBackend({
          modelPath: this.config.piperModelPath,
          format: this.config.format,
        });
      case 'kokoro':
        return new KokoroBackend({
          modelPath: this.config.kokoroModelPath,
          format: this.config.format,
        });
      case 'chatterbox':
        return new ChatterboxBackend();
      case 'openai':
        if (!this.config.openai) {
          throw new Error('OpenAI backend requires openai config (apiKey, baseUrl, model)');
        }
        return new OpenAiBackend(this.config.openai);
    }
  }

  private handleUnavailable(text: string): TtsSynthesisResult {
    const fallbackMode = this.config.fallbackMode;

    if (fallbackMode === 'captions-only') {
      return {
        audio: Buffer.alloc(0),
        durationMs: this.estimateDurationMs(text),
        text,
        fallback: true,
        backend: this.config.backend,
      };
    }

    return {
      audio: Buffer.alloc(0),
      durationMs: 0,
      text,
      fallback: true,
      backend: this.config.backend,
    };
  }

  private handleSynthesisError(text: string, error: unknown): TtsSynthesisResult {
    const fallbackMode = this.config.fallbackMode;

    if (fallbackMode === 'captions-only') {
      return {
        audio: Buffer.alloc(0),
        durationMs: this.estimateDurationMs(text),
        text,
        fallback: true,
        backend: this.config.backend,
      };
    }

    throw error;
  }

  private alignTiming(result: { audio: Buffer; durationMs: number; text: string }): {
    audio: Buffer;
    durationMs: number;
    text: string;
  } {
    if (!this.config.targetDurationMs) {
      return result;
    }

    const target = this.config.targetDurationMs;
    const actual = result.durationMs;

    if (actual < target) {
      // Pad with silence
      const silenceSamples = Math.round(((target - actual) / 1000) * 22050 * 2);
      const silence = Buffer.alloc(silenceSamples, 0);
      return {
        audio: Buffer.concat([result.audio, silence]),
        durationMs: target,
        text: result.text,
      };
    }

    if (actual > target) {
      // Truncate audio
      const truncateSamples = Math.round(((target) / 1000) * 22050 * 2);
      return {
        audio: result.audio.slice(0, truncateSamples),
        durationMs: target,
        text: result.text,
      };
    }

    return result;
  }

  private async saveAudio(
    result: { audio: Buffer; durationMs: number; text: string },
    text: string,
  ): Promise<string | undefined> {
    if (this.config.audioOutput !== 'sidecar') {
      return undefined;
    }

    if (!this.config.outputDir) {
      return undefined;
    }

    // Generate a safe filename from the text
    const safeText = text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
    const filename = `narration_${safeText}.wav`;
    const filePath = path.join(this.config.outputDir, filename);

    fs.mkdirSync(this.config.outputDir, { recursive: true });
    fs.writeFileSync(filePath, result.audio);

    return filePath;
  }

  private generateLicense(): string | undefined {
    if (!this.config.outputDir) {
      return undefined;
    }

    try {
      return generateLicenseFile(this.config.backend, this.config.outputDir) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private verifyModelSource(): void {
    if (!this.backend) return;

    const backendName = this.config.backend;

    // Piper model verification
    if (backendName === 'piper' && this.config.piperModelPath) {
      const verification = verifyModelSource(backendName, this.config.piperModelPath);
      if (!verification.valid) {
        console.warn(`[demoforge] TTS model verification warning: ${verification.reason}`);
      }
    }

    // Kokoro model verification
    if (backendName === 'kokoro' && this.config.kokoroModelPath) {
      const verification = verifyModelSource(backendName, this.config.kokoroModelPath);
      if (!verification.valid) {
        console.warn(`[demoforge] TTS model verification warning: ${verification.reason}`);
      }
    }
  }

  private estimateDurationMs(text: string): number {
    if (!text || text.trim().length === 0) return 0;

    const charsPerSecond = DEFAULT_CHARS_PER_SECOND * this.config.speechRate;
    return Math.round((text.trim().length / charsPerSecond) * 1000);
  }
}
