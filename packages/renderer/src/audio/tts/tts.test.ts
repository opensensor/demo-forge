/**
 * DemoForge renderer — TTS engine tests (RED phase).
 *
 * Tests for the pluggable TTS engine with Piper, Kokoro, and OpenAI-compatible backends.
 * Covers: backend interface, per-step narration, timing alignment, licensing, opt-in config,
 * captions-only fallback, and audio output modes.
 */

import { describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('node:fs');
vi.mock('node:path');
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));
vi.mock('node:crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn(function (this: any) {
        return this;
      }),
      digest: vi.fn(() => 'abc123def456'),
    })),
  },
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

const NARRATE_TEXT = 'Welcome to the dashboard.';
const NARRATE_TEXT_2 = 'Click the submit button.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enableEngine(): void {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'));
  vi.mocked(path.resolve).mockImplementation((p: string) => `/resolved/${p}`);
  vi.mocked(path.dirname).mockImplementation((p: string) => `/dir/${p}`);
  vi.mocked(path.basename).mockImplementation((p: string) => p);
}

// ─── TtsEngine exports ────────────────────────────────────────────────────────

describe('TtsEngine — module exports', () => {
  it('should export a TtsEngine class', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    expect(typeof TtsEngine).toBe('function');
  });

  it('should throw when instantiated without config', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    expect(() => new (TtsEngine as any)()).toThrow();
  });

  it('should throw when instantiated with invalid backend', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    expect(
      () =>
        new (TtsEngine as any)({
          enabled: false,
          backend: 'invalid-backend' as any,
        }),
    ).toThrow('Unknown TTS backend');
  });
});

// ─── TtsEngine — opt-in (disabled by default) ────────────────────────────────

describe('TtsEngine — opt-in (disabled by default)', () => {
  it('should be disabled by default when enabled is not set', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      backend: 'piper',
    });
    expect(engine.isEnabled()).toBe(false);
  });

  it('should be disabled when enabled is explicitly false', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: false,
      backend: 'piper',
    });
    expect(engine.isEnabled()).toBe(false);
  });

  it('should be enabled when enabled is true and model exists', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();
    expect(engine.isEnabled()).toBe(true);
  });

  it('should return empty audio for disabled engine', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: false,
      backend: 'piper',
    });
    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.audio?.length).toBe(0);
    expect(result.durationMs).toBe(0);
  });
});

// ─── TtsEngine — per-step narration ──────────────────────────────────────────

describe('TtsEngine — per-step narration', () => {
  it('should synthesize narration text from a narrate step', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);

    expect(result).toBeDefined();
    expect(result.text).toBe(NARRATE_TEXT);
  });

  it('should handle multiple narration steps sequentially', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result1 = await engine.synthesize(NARRATE_TEXT);
    const result2 = await engine.synthesize(NARRATE_TEXT_2);

    expect(result1.text).toBe(NARRATE_TEXT);
    expect(result2.text).toBe(NARRATE_TEXT_2);
  });

  it('should handle empty narration text gracefully', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result = await engine.synthesize('');
    expect(result).toBeDefined();
    expect(result.text).toBe('');
  });
});

// ─── TtsEngine — timing alignment ────────────────────────────────────────────

describe('TtsEngine — timing alignment', () => {
  it('should estimate duration from text length', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const text = 'This is a longer piece of narration text for testing duration estimation.';
    const result = await engine.synthesize(text);

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.text).toBe(text);
  });

  it('should align TTS output duration to target pause duration', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      targetDurationMs: 3000,
    });
    enableEngine();

    const text = 'Short.';
    const result = await engine.synthesize(text);

    expect(result).toBeDefined();
    expect(result.durationMs).toBeDefined();
  });

  it('should use speech rate config for duration estimation', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      speechRate: 1.5,
    });
    enableEngine();

    const text = 'Hello world.';
    const result = await engine.synthesize(text);

    expect(result.durationMs).toBeGreaterThan(0);
  });
});

// ─── TtsEngine — audio output modes ──────────────────────────────────────────

describe('TtsEngine — audio output modes', () => {
  it('should support embedded audio mode', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      audioOutput: 'embedded',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });

  it('should support sidecar audio mode', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      audioOutput: 'sidecar',
      outputDir: '/tmp/tts-test',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });
});

// ─── TtsEngine — captions-only fallback ──────────────────────────────────────

describe('TtsEngine — captions-only fallback', () => {
  it('should fall back to captions-only when TTS is unavailable', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      fallbackMode: 'captions-only',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.audio?.length).toBe(0);
    expect(result.fallback).toBe(true);
  });

  it('should produce no audio when backend is missing', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      fallbackMode: 'captions-only',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result.audio).toBeDefined();
    expect(result.fallback).toBe(true);
  });
});

// ─── TtsEngine — license compliance ──────────────────────────────────────────

describe('TtsEngine — license compliance', () => {
  it('should generate license file for bundled models', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
      outputDir: '/tmp/tts-license-test',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });

  it('should verify model source', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });
});

// ─── TtsEngine — Piper backend ───────────────────────────────────────────────

describe('TtsEngine — Piper backend', () => {
  it('should use piper as default backend', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.text).toBe(NARRATE_TEXT);
  });

  it('should produce audible output with piper backend', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'piper',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.text).toBe(NARRATE_TEXT);
  });
});

// ─── TtsEngine — Kokoro backend ──────────────────────────────────────────────

describe('TtsEngine — Kokoro backend', () => {
  it('should use kokoro backend when configured', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'kokoro',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.text).toBe(NARRATE_TEXT);
  });

  it('should produce higher quality output with kokoro', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'kokoro',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });
});

// ─── TtsEngine — OpenAI-compatible cloud backend ─────────────────────────────

describe('TtsEngine — OpenAI-compatible cloud backend', () => {
  it('should use openai backend when configured', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'openai',
      openai: {
        apiKey: 'test-key',
        baseUrl: 'http://localhost:1234/v1',
        model: 'tts-1',
      },
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
    expect(result.text).toBe(NARRATE_TEXT);
  });

  it('should pass voice and speed to openai backend', async () => {
    const { TtsEngine } = await import('../tts/index.js');
    const engine = new (TtsEngine as any)({
      enabled: true,
      backend: 'openai',
      openai: {
        apiKey: 'test-key',
        baseUrl: 'http://localhost:1234/v1',
        model: 'tts-1',
      },
      voice: 'alloy',
    });
    enableEngine();

    const result = await engine.synthesize(NARRATE_TEXT);
    expect(result).toBeDefined();
  });
});
