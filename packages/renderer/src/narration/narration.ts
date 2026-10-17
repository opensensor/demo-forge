/**
 * DemoForge narration — prepare narration clips before replay.
 *
 * Narration is synthesized up front so the replay knows how long each line
 * takes to speak and can hold the next action until it finishes. In
 * captions-only mode (or when TTS is unavailable) durations are estimated
 * from reading speed instead.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DemoScript, NarrationMode } from '@demoforge/core';
import { isNarrateStep } from '@demoforge/core';

import { TtsEngine } from '../audio/tts/engine.js';
import type { TtsBackendName } from '../audio/tts/types.js';

export interface NarrationClip {
  text: string;
  durationMs: number;
  /** WAV file for this line; absent when not spoken. */
  audioPath?: string;
}

export interface NarrationOptions {
  /** Overrides the script's narration_mode. */
  mode?: NarrationMode;
  backend?: TtsBackendName;
  voice?: string;
  speed?: number;
  /** Directory for synthesized WAVs (cached across runs by text + voice). */
  audioDir: string;
  onLog?: (message: string) => void;
}

/** Comfortable on-screen reading time for a caption. */
export function readingTimeMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1800, Math.round((words / 2.8) * 1000) + 400);
}

/** Duration of a PCM WAV buffer, read from its header. */
export function wavDurationMs(wav: Buffer): number {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') {
    return 0;
  }
  const byteRate = wav.readUInt32LE(28);
  // Walk chunks to find "data" (headers are not always exactly 44 bytes).
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') {
      const dataBytes = Math.min(size, wav.length - offset - 8);
      return byteRate > 0 ? Math.round((dataBytes / byteRate) * 1000) : 0;
    }
    offset += 8 + size;
  }
  return 0;
}

/**
 * Build a narration clip for every narrate step, keyed by step index.
 */
export async function prepareNarration(
  script: DemoScript,
  options: NarrationOptions,
): Promise<Map<number, NarrationClip>> {
  const mode = options.mode ?? script.narration_mode;
  const clips = new Map<number, NarrationClip>();
  const lines = script.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => isNarrateStep(step)) as Array<{ step: { narrate: string }; index: number }>;

  if (mode !== 'tts') {
    for (const { step, index } of lines) {
      clips.set(index, { text: step.narrate, durationMs: readingTimeMs(step.narrate) });
    }
    return clips;
  }

  const backend = options.backend ?? 'kokoro';
  const voice = options.voice ?? script.voice ?? '';
  const engine = new TtsEngine({
    enabled: true,
    backend,
    voice: voice || undefined,
    speechRate: options.speed ?? 1.0,
    fallbackMode: 'captions-only',
  });

  if (!(await engine.isReady())) {
    options.onLog?.(`TTS backend "${backend}" is not available — falling back to captions-only timing`);
    for (const { step, index } of lines) {
      clips.set(index, { text: step.narrate, durationMs: readingTimeMs(step.narrate) });
    }
    return clips;
  }

  fs.mkdirSync(options.audioDir, { recursive: true });

  for (const { step, index } of lines) {
    const key = createHash('sha1')
      .update(`${backend}\0${voice}\0${options.speed ?? 1}\0${step.narrate}`)
      .digest('hex')
      .slice(0, 16);
    const audioPath = path.join(options.audioDir, `${key}.wav`);

    if (!fs.existsSync(audioPath)) {
      const result = await engine.synthesize(step.narrate);
      if (result.fallback || !result.audio || result.audio.length === 0) {
        options.onLog?.(`TTS failed for step ${index}; using captions-only timing for that line`);
        clips.set(index, { text: step.narrate, durationMs: readingTimeMs(step.narrate) });
        continue;
      }
      fs.writeFileSync(audioPath, result.audio);
      options.onLog?.(`synthesized narration for step ${index}`);
    }

    const durationMs = wavDurationMs(fs.readFileSync(audioPath));
    clips.set(index, { text: step.narrate, durationMs, audioPath });
  }

  return clips;
}
