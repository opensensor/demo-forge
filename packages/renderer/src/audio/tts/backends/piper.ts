/**
 * DemoForge renderer — Piper TTS backend (local, default).
 *
 * Piper is a fast, local neural TTS system. It uses the piper binary
 * to synthesize speech from text input.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TtsBackend, BackendSynthesizeOptions, SynthesisResult, AudioFormat } from '../types.js';

// Default Piper voice model (English — en_US-lessac-medium)
const DEFAULT_PIPER_VOICE = 'en_US-lessac-medium';

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

export class PiperBackend implements TtsBackend {
  private modelPath?: string;

  constructor(options?: { modelPath?: string; format?: AudioFormat }) {
    this.modelPath = options?.modelPath;
  }

  getName(): string {
    return 'piper';
  }

  async isAvailable(): Promise<boolean> {
    // Check if piper binary exists
    const piperBinary = this.resolvePiperBinary();
    if (!piperBinary || !fs.existsSync(piperBinary)) {
      return false;
    }

    // Check if model file exists
    const modelFile = this.resolveModelFile();
    return modelFile ? fs.existsSync(modelFile) : false;
  }

  async synthesize(text: string, _options?: BackendSynthesizeOptions): Promise<SynthesisResult> {
    if (!text) {
      return { audio: Buffer.alloc(0), durationMs: 0, text: '' };
    }

    const piperBinary = this.resolvePiperBinary();
    if (!piperBinary || !fs.existsSync(piperBinary)) {
      throw new Error(`Piper binary not found. Install piper: https://github.com/rhasspy/piper`);
    }

    const modelFile = this.resolveModelFile();
    if (!modelFile || !fs.existsSync(modelFile)) {
      throw new Error(`Piper model not found: ${modelFile}`);
    }

    // Piper reads text from stdin and outputs audio to stdout
    const result = spawnSync(
      piperBinary,
      [
        '--model',
        modelFile,
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
      throw new Error(`Piper synthesis failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.toString('utf-8') || 'unknown error';
      throw new Error(`Piper exited with code ${result.status}: ${stderr}`);
    }

    const audio: Buffer = result.stdout ?? Buffer.alloc(0);
    // Piper produces ~22050 Hz mono 16-bit PCM WAV
    // Duration = (audio.length - 44) / (22050 * 2) seconds (subtract WAV header)
    const durationMs = Math.max(0, Math.round((audio.length - 44) / (22050 * 2) * 1000));

    return { audio, durationMs, text };
  }

  private resolvePiperBinary(): string | null {
    // Try PATH first, then vendored and common install locations
    const candidates = [
      findInPath('piper'),
      path.join(MODULE_DIR, '..', '..', 'vendor', 'piper', 'piper'),
      '/usr/local/bin/piper',
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

    // Try to find model in default locations
    const modelCandidates = [
      path.join(MODULE_DIR, '..', '..', 'vendor', 'piper', 'voices', `${DEFAULT_PIPER_VOICE}.onnx`),
      path.join(MODULE_DIR, '..', '..', 'vendor', 'piper', 'voices', `${DEFAULT_PIPER_VOICE}.onnx.json`),
      `/usr/local/share/piper/voices/${DEFAULT_PIPER_VOICE}.onnx`,
    ];

    for (const candidate of modelCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }
}
