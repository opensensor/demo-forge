/**
 * DemoForge renderer — Kokoro TTS backend (local, higher quality).
 *
 * Kokoro is a higher-quality local neural TTS model. It uses the kokoro
 * binary to synthesize speech from text input with better voice quality
 * than Piper.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TtsBackend, BackendSynthesizeOptions, SynthesisResult, AudioFormat } from '../types.js';

// Default Kokoro voice model
const DEFAULT_KOKORO_VOICE = 'af_heart';

// ESM equivalent of __dirname
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Locate a binary by scanning the directories in process.env.PATH. */
function findInPath(binary: string): string | null {
  const envPath = process.env.PATH ?? '';
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export class KokoroBackend implements TtsBackend {
  private modelPath?: string;

  constructor(options?: { modelPath?: string; format?: AudioFormat }) {
    this.modelPath = options?.modelPath;
  }

  getName(): string {
    return 'kokoro';
  }

  async isAvailable(): Promise<boolean> {
    const kokoroBinary = this.resolveKokoroBinary();
    if (!kokoroBinary || !fs.existsSync(kokoroBinary)) {
      return false;
    }

    const modelFile = this.resolveModelFile();
    return modelFile ? fs.existsSync(modelFile) : false;
  }

  async synthesize(text: string, options?: BackendSynthesizeOptions): Promise<SynthesisResult> {
    if (!text) {
      return { audio: Buffer.alloc(0), durationMs: 0, text: '' };
    }

    const kokoroBinary = this.resolveKokoroBinary();
    if (!kokoroBinary || !fs.existsSync(kokoroBinary)) {
      throw new Error(`Kokoro binary not found. Install kokoro: https://huggingface.co/hexgrad/Kokoro-82M`);
    }

    const modelFile = this.resolveModelFile();
    if (!modelFile || !fs.existsSync(modelFile)) {
      throw new Error(`Kokoro model not found: ${modelFile}`);
    }

    const voice = options?.voice || DEFAULT_KOKORO_VOICE;
    const speed = options?.speed ?? 1.0;

    // Kokoro reads text from stdin, outputs audio to stdout
    const result = spawnSync(
      kokoroBinary,
      [
        '--model',
        modelFile,
        '--voice',
        voice,
        '--speed',
        String(speed),
        '--output_raw',
      ],
      {
        input: text,
        timeout: 30000,
        // No encoding: stdout must stay a Buffer — PCM audio is binary and
        // would be corrupted by utf-8 decoding.
      },
    );

    if (result.error) {
      throw new Error(`Kokoro synthesis failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.toString('utf-8') || 'unknown error';
      throw new Error(`Kokoro exited with code ${result.status}: ${stderr}`);
    }

    const audio: Buffer = result.stdout ?? Buffer.alloc(0);
    // Kokoro produces ~24000 Hz mono 16-bit PCM WAV
    const durationMs = Math.max(0, Math.round((audio.length - 44) / (24000 * 2) * 1000));

    return { audio, durationMs, text };
  }

  private resolveKokoroBinary(): string | null {
    // Try PATH first, then vendored and common install locations
    const candidates = [
      process.env.DEMOFORGE_KOKORO_BIN ?? null,
      findInPath('kokoro'),
      path.join(MODULE_DIR, '..', '..', 'vendor', 'kokoro', 'kokoro'),
      '/usr/local/bin/kokoro',
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private resolveModelFile(): string | null {
    if (this.modelPath && fs.existsSync(this.modelPath)) {
      return this.modelPath;
    }

    const envModel = process.env.DEMOFORGE_KOKORO_MODEL;
    if (envModel && fs.existsSync(envModel)) {
      return envModel;
    }

    const modelCandidates = [
      path.join(MODULE_DIR, '..', '..', 'vendor', 'kokoro', 'models', `${DEFAULT_KOKORO_VOICE}.onnx`),
      `/usr/local/share/kokoro/models/${DEFAULT_KOKORO_VOICE}.onnx`,
    ];

    for (const candidate of modelCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
