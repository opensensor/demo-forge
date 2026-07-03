/**
 * DemoForge renderer — OpenAI-compatible TTS backend (cloud voices).
 *
 * Uses any OpenAI-compatible API endpoint for TTS synthesis.
 * Supports the standard /v1/audio/speech endpoint.
 */

import type { TtsBackend, BackendSynthesizeOptions, SynthesisResult, OpenAiTtsConfig } from '../types.js';

export class OpenAiBackend implements TtsBackend {
  private config: OpenAiTtsConfig;

  constructor(config: OpenAiTtsConfig) {
    this.config = config;
  }

  getName(): string {
    return 'openai';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, options?: BackendSynthesizeOptions): Promise<SynthesisResult> {
    if (!text) {
      return { audio: Buffer.alloc(0), durationMs: 0, text: '' };
    }

    const voice = options?.voice ?? 'alloy';
    const model = this.config.model ?? 'tts-1';
    const speed = options?.speed ?? 1.0;

    const response = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: 'wav',
        speed,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      throw new Error(`OpenAI TTS API error (${response.status}): ${errorBody}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Estimate duration from text length for OpenAI responses
    // (OpenAI doesn't return duration in the response)
    const durationMs = estimateDurationMs(text, speed);

    return { audio: audioBuffer, durationMs, text };
  }
}

/**
 * Estimate audio duration based on text length and speech rate.
 * Uses a rough estimate of ~4.5 characters per second at normal speed.
 */
function estimateDurationMs(text: string, speed: number): number {
  if (!text || text.trim().length === 0) return 0;

  const charCount = text.trim().length;
  const charsPerSecond = 4.5 * speed;
  return Math.round((charCount / charsPerSecond) * 1000);
}
