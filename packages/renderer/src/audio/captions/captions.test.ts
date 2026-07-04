/**
 * DemoForge renderer — CaptionGenerator tests (RED phase).
 *
 * Tests for SRT and VTT generation, caption styling, sidecar files,
 * burned-in captions, and timing alignment with TTS/narrate steps.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('node:fs');
vi.mock('node:path');
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TEST_OUTPUT_DIR = '/tmp/demoforge-captions-test';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFs(): void {
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(path.dirname).mockImplementation((p: string) => {
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.substring(0, idx) : '.';
  });
  vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'));
  vi.mocked(path.resolve).mockImplementation((p: string) => `/resolved/${p}`);
  vi.mocked(path.basename).mockImplementation((p: string) => p);
}

// ─── CaptionGenerator — module exports ────────────────────────────────────────

describe('CaptionGenerator — module exports', () => {
  it('should export a CaptionGenerator class', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    expect(typeof CaptionGenerator).toBe('function');
  });

  it('should instantiate without arguments', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen).toBeDefined();
  });

  it('should instantiate with style options', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({
      style: { fontFamily: 'Helvetica', fontSize: 20 },
    });
    expect(gen).toBeDefined();
  });

  it('should instantiate with outputDir option', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    expect(gen).toBeDefined();
  });
});

// ─── CaptionGenerator — default style ─────────────────────────────────────────

describe('CaptionGenerator — default style', () => {
  it('should have default font family', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().fontFamily).toBe('Arial');
  });

  it('should have default font size', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().fontSize).toBe(24);
  });

  it('should have default font color', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().fontColor).toBe('#FFFFFF');
  });

  it('should have default background color', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().backgroundColor).toBe('#00000080');
  });

  it('should have default horizontal alignment', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().horizontalAlign).toBe('center');
  });

  it('should have default vertical alignment', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().verticalAlign).toBe('bottom');
  });

  it('should have default border style', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    expect(gen.getStyle().borderStyle).toBe('box');
  });
});

// ─── CaptionGenerator — adding entries ────────────────────────────────────────

describe('CaptionGenerator — adding entries', () => {
  it('should add a single entry', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 2000 });
    expect(gen.getEntryCount()).toBe(1);
  });

  it('should assign sequential indices starting from 1', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'First', startTime: 0, duration: 1000 });
    gen.addEntry({ text: 'Second', startTime: 1000, duration: 1000 });
    gen.addEntry({ text: 'Third', startTime: 2000, duration: 1000 });

    const entries = gen.getEntries();
    expect(entries[0].index).toBe(1);
    expect(entries[1].index).toBe(2);
    expect(entries[2].index).toBe(3);
  });

  it('should add multiple entries at once', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntries([
      { text: 'A', startTime: 0, duration: 1000 },
      { text: 'B', startTime: 1000, duration: 1000 },
    ]);
    expect(gen.getEntryCount()).toBe(2);
  });

  it('should return entries in insertion order', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Second', startTime: 1000, duration: 1000 });
    gen.addEntry({ text: 'First', startTime: 0, duration: 1000 });

    const entries = gen.getEntries();
    expect(entries[0].text).toBe('Second');
    expect(entries[1].text).toBe('First');
  });

  it('should clear all entries', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 1000 });
    gen.clear();
    expect(gen.getEntryCount()).toBe(0);
  });
});

// ─── CaptionGenerator — SRT generation ────────────────────────────────────────

describe('CaptionGenerator — SRT generation', () => {
  it('should generate valid SRT format for a single caption', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello world', startTime: 1000, duration: 2000 });

    const srt = gen.generateSrt();

    expect(srt).toContain('1\n');
    expect(srt).toContain('00:00:01,000 --> 00:00:03,000');
    expect(srt).toContain('Hello world');
  });

  it('should generate valid SRT format for multiple captions', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'First caption', startTime: 0, duration: 2000 });
    gen.addEntry({ text: 'Second caption', startTime: 3000, duration: 2000 });

    const srt = gen.generateSrt();

    expect(srt).toContain('1\n');
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('First caption');
    expect(srt).toContain('2\n');
    expect(srt).toContain('00:00:03,000 --> 00:00:05,000');
    expect(srt).toContain('Second caption');
  });

  it('should format SRT timestamps with correct separator (comma for millis)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Test', startTime: 1234, duration: 567 });

    const srt = gen.generateSrt();

    expect(srt).toContain('00:00:01,234');
    expect(srt).toContain('00:00:01,801');
  });

  it('should separate captions with blank lines', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'A', startTime: 0, duration: 1000 });
    gen.addEntry({ text: 'B', startTime: 1000, duration: 1000 });

    const srt = gen.generateSrt();

    // SRT blocks are separated by two newlines
    expect(srt).toContain('A\n\n');
  });

  it('should escape HTML entities in SRT text', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Use <b>bold</b> & <i>italic</i>', startTime: 0, duration: 2000 });

    const srt = gen.generateSrt();

    expect(srt).toContain('&amp;');
    expect(srt).toContain('&lt;b&gt;');
    expect(srt).toContain('&lt;i&gt;');
    expect(srt).not.toContain('<b>');
    expect(srt).not.toContain('<i>');
  });

  it('should return empty string for no entries', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const srt = gen.generateSrt();
    expect(srt).toBe('');
  });

  it('should handle zero start time', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Start at zero', startTime: 0, duration: 1000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000');
  });

  it('should handle large timestamp values (hours)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Late caption', startTime: 3661000, duration: 1000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('01:01:01,000 --> 01:01:02,000');
  });
});

// ─── CaptionGenerator — VTT generation ────────────────────────────────────────

describe('CaptionGenerator — VTT generation', () => {
  it('should generate valid WebVTT header', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 1000 });

    const vtt = gen.generateVtt();

    expect(vtt).toContain('WEBVTT');
  });

  it('should generate valid VTT timestamps (dot separator)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Test', startTime: 1234, duration: 567 });

    const vtt = gen.generateVtt();

    expect(vtt).toContain('00:00:01.234');
    expect(vtt).toContain('00:00:01.801');
  });

  it('should format VTT with correct structure', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Caption text', startTime: 500, duration: 2000 });

    const vtt = gen.generateVtt();

    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('1');
    expect(vtt).toContain('00:00:00.500 --> 00:00:02.500');
    expect(vtt).toContain('Caption text');
  });

  it('should include multiple VTT entries', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'First', startTime: 0, duration: 1000 });
    gen.addEntry({ text: 'Second', startTime: 1500, duration: 1000 });

    const vtt = gen.generateVtt();

    expect(vtt).toContain('1');
    expect(vtt).toContain('First');
    expect(vtt).toContain('2');
    expect(vtt).toContain('Second');
  });

  it('should return minimal VTT for no entries', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const vtt = gen.generateVtt();

    expect(vtt).toBe('WEBVTT\n\n');
  });

  it('should not escape HTML in VTT (WebVTT supports HTML)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: '<b>Bold</b> text', startTime: 0, duration: 1000 });

    const vtt = gen.generateVtt();

    expect(vtt).toContain('<b>Bold</b>');
    expect(vtt).not.toContain('&lt;b&gt;');
  });
});

// ─── CaptionGenerator — SRT vs VTT timestamp differences ─────────────────────

describe('CaptionGenerator — SRT vs VTT timestamp format', () => {
  it('should use comma separator in SRT timestamps', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Test', startTime: 1234, duration: 567 });

    const srt = gen.generateSrt();
    expect(srt).toContain(',234');
    expect(srt).not.toContain('.234');
  });

  it('should use dot separator in VTT timestamps', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Test', startTime: 1234, duration: 567 });

    const vtt = gen.generateVtt();
    expect(vtt).toContain('.234');
    expect(vtt).not.toContain(',234');
  });
});

// ─── CaptionGenerator — styling ───────────────────────────────────────────────

describe('CaptionGenerator — styling', () => {
  it('should accept custom font family', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { fontFamily: 'Helvetica' } });
    expect(gen.getStyle().fontFamily).toBe('Helvetica');
  });

  it('should accept custom font size', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { fontSize: 32 } });
    expect(gen.getStyle().fontSize).toBe(32);
  });

  it('should accept custom font color', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { fontColor: '#FF0000' } });
    expect(gen.getStyle().fontColor).toBe('#FF0000');
  });

  it('should accept custom background color', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { backgroundColor: '#0000FF80' } });
    expect(gen.getStyle().backgroundColor).toBe('#0000FF80');
  });

  it('should accept custom horizontal alignment', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { horizontalAlign: 'left' } });
    expect(gen.getStyle().horizontalAlign).toBe('left');
  });

  it('should accept custom vertical alignment', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { verticalAlign: 'top' } });
    expect(gen.getStyle().verticalAlign).toBe('top');
  });

  it('should accept percentage-based vertical alignment', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { verticalAlign: '75%' } });
    expect(gen.getStyle().verticalAlign).toBe('75%');
  });

  it('should accept custom border style', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { borderStyle: 'outline' } });
    expect(gen.getStyle().borderStyle).toBe('outline');
  });

  it('should accept custom border color and width', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({
      style: { borderColor: '#FF0000', borderWidth: 4 },
    });
    expect(gen.getStyle().borderColor).toBe('#FF0000');
    expect(gen.getStyle().borderWidth).toBe(4);
  });

  it('should allow style updates after construction', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.setStyle({ fontFamily: 'Courier', fontSize: 18 });
    expect(gen.getStyle().fontFamily).toBe('Courier');
    expect(gen.getStyle().fontSize).toBe(18);
    // Default values should be preserved for non-updated fields
    expect(gen.getStyle().fontColor).toBe('#FFFFFF');
  });
});

// ─── CaptionGenerator — sidecar file writing ──────────────────────────────────

describe('CaptionGenerator — sidecar file writing', () => {
  beforeEach(() => {
    mockFs();
  });

  it('should write SRT file to output directory', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 1000 });

    const result = gen.write('srt');

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });

  it('should write VTT file to output directory', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 1000 });

    const result = gen.write('vtt');

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(typeof result).toBe('string');
  });

  it('should write both SRT and VTT sidecar files', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    gen.addEntry({ text: 'Hello', startTime: 0, duration: 1000 });
    gen.addEntry({ text: 'World', startTime: 1000, duration: 1000 });

    const result = gen.writeSidecarFiles();

    expect(result.success).toBe(true);
    expect(result.srtPath).toContain('.srt');
    expect(result.vttPath).toContain('.vtt');
    expect(result.captionCount).toBe(2);
  });

  it('should write sidecar files with custom base path', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    gen.addEntry({ text: 'Test', startTime: 0, duration: 1000 });

    const result = gen.writeSidecarFiles('/tmp/custom-captions');

    expect(result.srtPath).toBe('/tmp/custom-captions.srt');
    expect(result.vttPath).toBe('/tmp/custom-captions.vtt');
  });

  it('should create output directory if it does not exist', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ outputDir: TEST_OUTPUT_DIR });
    gen.addEntry({ text: 'Test', startTime: 0, duration: 1000 });

    gen.writeSidecarFiles();

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

// ─── CaptionGenerator — subtitles filter building ─────────────────────────────

describe('CaptionGenerator — subtitles filter building', () => {
  it('should build a subtitles filter with default style', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    expect(result.filterArg).toContain('subtitles=');
    expect(result.filterArg).toContain('captions.srt');
    expect(result.filterArg).toContain('FontSize=24');
    expect(result.filterArg).toContain('PrimaryColour=&H00FFFFFF');
    expect(result.filterArg).toContain('BorderStyle=3');
    expect(result.filterArg).toContain('BackColour=&H7F000000');
  });

  it('should build a subtitles filter with custom style', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { fontSize: 32, fontColor: '#FFFF00' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    expect(result.filterArg).toContain('FontSize=32');
    expect(result.filterArg).toContain('PrimaryColour=&H0000FFFF');
  });

  it('should escape special characters in the SRT path for the filter graph', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/my:captions.srt');

    expect(result.filterArg).toContain('my\\:captions.srt');
  });

  it('should build correct ffmpeg args for burned-in captions', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    expect(result.ffmpegArgs).toContain('-y');
    expect(result.ffmpegArgs).toContain('-i');
    expect(result.ffmpegArgs).toContain('/tmp/input.mp4');
    expect(result.ffmpegArgs).toContain('-filter_complex');
    expect(result.ffmpegArgs).toContain(result.filterArg);
    expect(result.ffmpegArgs).toContain('-c:v');
    expect(result.ffmpegArgs).toContain('libx264');
    // The SRT is consumed by the subtitles filter, not as a second input
    expect(result.ffmpegArgs).not.toContain('/tmp/captions.srt');
  });

  it('should build muxer args for subtitle stream embedding', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    const args = gen.buildSubMuxerArgs('/tmp/input.mp4', '/tmp/captions.srt');

    expect(args).toContain('-c:s');
    expect(args).toContain('mov_text');
    expect(args).toContain('/tmp/captions_subtitled.mp4');
  });

  it('should handle left horizontal alignment in filter', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { horizontalAlign: 'left' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    // ASS numpad alignment: bottom-left = 1
    expect(result.filterArg).toContain('Alignment=1');
  });

  it('should handle right horizontal alignment in filter', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { horizontalAlign: 'right' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    // ASS numpad alignment: bottom-right = 3
    expect(result.filterArg).toContain('Alignment=3');
  });

  it('should handle top vertical alignment in filter', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { verticalAlign: 'top' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    // ASS numpad alignment: top-center = 8
    expect(result.filterArg).toContain('Alignment=8');
  });

  it('should handle percentage-based vertical alignment in filter', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { verticalAlign: '80%' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    // 80% down the frame maps to the bottom row (bottom-center = 2)
    expect(result.filterArg).toContain('Alignment=2');
  });

  it('should handle no border style in filter', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator({ style: { borderStyle: 'none' } });
    const result = gen.buildSubFilter('/tmp/input.mp4', '/tmp/captions.srt');

    expect(result.filterArg).toContain('Outline=2');
    expect(result.filterArg).toContain('BorderStyle=1');
  });
});

// ─── CaptionGenerator — timing edge cases ─────────────────────────────────────

describe('CaptionGenerator — timing edge cases', () => {
  it('should handle very short duration (1ms)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Quick', startTime: 0, duration: 1 });

    const srt = gen.generateSrt();
    expect(srt).toContain('00:00:00,000 --> 00:00:00,001');
  });

  it('should handle caption with text spanning multiple lines', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Line 1\nLine 2', startTime: 0, duration: 2000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('Line 1');
    expect(srt).toContain('Line 2');
  });

  it('should handle special characters in caption text', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Quote: "hello" and apostrophe: it\'s', startTime: 0, duration: 1000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('Quote: "hello"');
    expect(srt).toContain("it's");
  });

  it('should handle non-Latin characters (CJK, emoji)', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'こんにちは 🌍', startTime: 0, duration: 2000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('こんにちは');
    expect(srt).toContain('🌍');
  });

  it('should handle overlapping captions', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'First', startTime: 0, duration: 3000 });
    gen.addEntry({ text: 'Second', startTime: 1000, duration: 2000 });

    const srt = gen.generateSrt();
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000');
    expect(srt).toContain('00:00:01,000 --> 00:00:03,000');
  });
});

// ─── BurnedInCaptions — module exports ────────────────────────────────────────

describe('BurnedInCaptions — module exports', () => {
  it('should export a BurnedInCaptions class', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    expect(typeof BurnedInCaptions).toBe('function');
  });

  it('should instantiate without arguments', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    expect(bic).toBeDefined();
  });

  it('should accept custom ffmpeg path', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions({ ffmpegPath: '/usr/bin/ffmpeg' });
    expect(bic).toBeDefined();
  });
});

// ─── BurnedInCaptions — filter building ───────────────────────────────────────

describe('BurnedInCaptions — filter building', () => {
  it('should build a subtitles filter for burned-in captions', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    const result = bic.buildFilter('/tmp/input.mp4', '/tmp/captions.srt');

    expect(result.filterArg).toContain('subtitles=');
    expect(result.filterArg).toContain('captions.srt');
    expect(result.filterArg).toContain('FontSize=24');
    expect(result.filterArg).toContain('PrimaryColour=&H00FFFFFF');
    expect(result.ffmpegArgs).toContain('-c:v');
    expect(result.ffmpegArgs).toContain('libx264');
  });

  it('should escape special characters in the SRT path for the filter graph', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    const result = bic.buildFilter('/tmp/input.mp4', '/tmp/my:captions.srt');

    expect(result.filterArg).toContain('my\\:captions.srt');
  });

  it('should honor a custom output path in filter args', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    const result = bic.buildFilter('/tmp/input.mp4', '/tmp/captions.srt', '/tmp/custom-output.mp4');

    expect(result.ffmpegArgs[result.ffmpegArgs.length - 1]).toBe('/tmp/custom-output.mp4');
  });

  it('should build muxer args for subtitle embedding', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    const args = bic.buildMuxerArgs('/tmp/input.mp4', '/tmp/captions.srt');

    expect(args).toContain('-c:s');
    expect(args).toContain('mov_text');
  });

  it('should use custom output path in muxer args', async () => {
    const { BurnedInCaptions } = await import('./burned-in.js');
    const bic = new BurnedInCaptions();
    const args = bic.buildMuxerArgs('/tmp/input.mp4', '/tmp/captions.srt', '/tmp/output.mp4');

    expect(args).toContain('/tmp/output.mp4');
  });
});

// ─── SidecarCaptionWriter — module exports ────────────────────────────────────

describe('SidecarCaptionWriter — module exports', () => {
  it('should export a SidecarCaptionWriter class', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    expect(typeof SidecarCaptionWriter).toBe('function');
  });

  it('should instantiate without arguments', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter();
    expect(writer).toBeDefined();
  });

  it('should accept custom output directory', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter({ outputDir: '/tmp/my-output' });
    expect(writer).toBeDefined();
  });

  it('should accept custom style', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter({ style: { fontSize: 28 } });
    expect(writer).toBeDefined();
  });
});

// ─── SidecarCaptionWriter — write ─────────────────────────────────────────────

describe('SidecarCaptionWriter — write', () => {
  beforeEach(() => {
    mockFs();
  });

  it('should write SRT and VTT sidecar files', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter({ outputDir: TEST_OUTPUT_DIR });
    const entries = [
      { index: 1, text: 'Hello', startTime: 0, duration: 1000, source: 'tts' },
      { index: 2, text: 'World', startTime: 1000, duration: 1000, source: 'tts' },
    ];

    const result = writer.write(entries, 'demo');

    expect(result.success).toBe(true);
    expect(result.srtPath).toContain('.srt');
    expect(result.vttPath).toContain('.vtt');
    expect(result.captionCount).toBe(2);
  });

  it('should create output directory if needed', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter({ outputDir: TEST_OUTPUT_DIR });
    const entries = [{ index: 1, text: 'Test', startTime: 0, duration: 1000 }];

    writer.write(entries);

    expect(fs.mkdirSync).toHaveBeenCalledWith(TEST_OUTPUT_DIR, { recursive: true });
  });

  it('should use default video base name when not provided', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const writer = new SidecarCaptionWriter({ outputDir: TEST_OUTPUT_DIR });
    const entries = [{ index: 1, text: 'Test', startTime: 0, duration: 1000 }];

    const result = writer.write(entries);

    expect(result.srtPath).toContain('captions.srt');
  });
});

// ─── SidecarCaptionWriter — entriesFromTtsResults ─────────────────────────────

describe('SidecarCaptionWriter — entriesFromTtsResults', () => {
  it('should generate caption entries from TTS results', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const ttsResults = [
      { text: 'Hello', durationMs: 1000, fallback: false },
      { text: 'World', durationMs: 1500, fallback: false },
    ];

    const entries = SidecarCaptionWriter.entriesFromTtsResults(ttsResults);

    expect(entries.length).toBe(2);
    expect(entries[0].text).toBe('Hello');
    expect(entries[0].startTime).toBe(0);
    expect(entries[0].duration).toBe(1000);
    expect(entries[0].source).toBe('tts');
    expect(entries[1].startTime).toBe(1000);
    expect(entries[1].duration).toBe(1500);
  });

  it('should skip empty text entries', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const ttsResults = [
      { text: 'Hello', durationMs: 1000 },
      { text: '', durationMs: 500 },
      { text: 'World', durationMs: 1000 },
    ];

    const entries = SidecarCaptionWriter.entriesFromTtsResults(ttsResults);

    expect(entries.length).toBe(2);
    expect(entries[0].text).toBe('Hello');
    expect(entries[1].text).toBe('World');
  });

  it('should use fallback source for fallback results', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const ttsResults = [
      { text: 'Fallback text', durationMs: 1000, fallback: true },
    ];

    const entries = SidecarCaptionWriter.entriesFromTtsResults(ttsResults);

    expect(entries[0].source).toBe('fallback');
  });

  it('should respect a custom start time offset', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const ttsResults = [
      { text: 'Hello', durationMs: 1000 },
    ];

    const entries = SidecarCaptionWriter.entriesFromTtsResults(ttsResults, 5000);

    expect(entries[0].startTime).toBe(5000);
  });

  it('should handle empty TTS results', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const entries = SidecarCaptionWriter.entriesFromTtsResults([]);
    expect(entries.length).toBe(0);
  });
});

// ─── SidecarCaptionWriter — entriesFromNarrateSteps ───────────────────────────

describe('SidecarCaptionWriter — entriesFromNarrateSteps', () => {
  it('should generate caption entries from narrate steps', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const narrateSteps = [
      { text: 'Welcome', duration: 2000 },
      { text: 'Click submit', duration: 1500 },
    ];

    const entries = SidecarCaptionWriter.entriesFromNarrateSteps(narrateSteps);

    expect(entries.length).toBe(2);
    expect(entries[0].text).toBe('Welcome');
    expect(entries[0].startTime).toBe(0);
    expect(entries[0].duration).toBe(2000);
    expect(entries[0].source).toBe('narrate-step-1');
    expect(entries[1].source).toBe('narrate-step-2');
  });

  it('should skip empty narrate steps', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const narrateSteps = [
      { text: 'Welcome', duration: 2000 },
      { text: '', duration: 500 },
      { text: 'Done', duration: 1000 },
    ];

    const entries = SidecarCaptionWriter.entriesFromNarrateSteps(narrateSteps);

    expect(entries.length).toBe(2);
  });

  it('should respect a custom start time offset', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const narrateSteps = [{ text: 'Test', duration: 1000 }];

    const entries = SidecarCaptionWriter.entriesFromNarrateSteps(narrateSteps, 3000);

    expect(entries[0].startTime).toBe(3000);
  });

  it('should handle empty narrate steps array', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const entries = SidecarCaptionWriter.entriesFromNarrateSteps([]);
    expect(entries.length).toBe(0);
  });
});

// ─── Integration — SRT round-trip validation ──────────────────────────────────

describe('Integration — SRT round-trip', () => {
  beforeEach(() => {
    mockFs();
  });

  it('should produce SRT that can be parsed back', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello world', startTime: 1000, duration: 2000 });
    gen.addEntry({ text: 'Goodbye', startTime: 5000, duration: 1000 });

    const srt = gen.generateSrt();

    // Parse back
    const blocks = srt.trim().split('\n\n');
    expect(blocks.length).toBe(2);

    // First block
    const block1Lines = blocks[0].split('\n');
    expect(block1Lines[0]).toBe('1');
    expect(block1Lines[1]).toContain('-->');
    expect(block1Lines[2]).toBe('Hello world');

    // Second block
    const block2Lines = blocks[1].split('\n');
    expect(block2Lines[0]).toBe('2');
    expect(block2Lines[2]).toBe('Goodbye');
  });
});

// ─── Integration — VTT round-trip validation ──────────────────────────────────

describe('Integration — VTT round-trip', () => {
  beforeEach(() => {
    mockFs();
  });

  it('should produce valid WebVTT that can be parsed back', async () => {
    const { CaptionGenerator } = await import('./generator.js');
    const gen = new CaptionGenerator();
    gen.addEntry({ text: 'Hello world', startTime: 0, duration: 2000 });

    const vtt = gen.generateVtt();

    // Parse back
    const lines = vtt.trim().split('\n');
    expect(lines[0]).toBe('WEBVTT');

    // Find the entry block (skip header)
    const entryStart = lines.findIndex((l) => l === '1');
    expect(entryStart).toBeGreaterThan(0);
    expect(lines[entryStart + 1]).toContain('-->');
    expect(lines[entryStart + 2]).toBe('Hello world');
  });
});

// ─── Integration — TTS timing alignment ───────────────────────────────────────

describe('Integration — TTS timing alignment', () => {
  it('should produce correctly timed captions from TTS results', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const ttsResults = [
      { text: 'Step 1 narration', durationMs: 2000 },
      { text: 'Step 2 narration', durationMs: 3000 },
      { text: 'Step 3 narration', durationMs: 1500 },
    ];

    const entries = SidecarCaptionWriter.entriesFromTtsResults(ttsResults);

    expect(entries.length).toBe(3);
    expect(entries[0].startTime).toBe(0);
    expect(entries[0].duration).toBe(2000);
    expect(entries[1].startTime).toBe(2000);
    expect(entries[1].duration).toBe(3000);
    expect(entries[2].startTime).toBe(5000);
    expect(entries[2].duration).toBe(1500);
  });

  it('should produce correctly timed captions from narrate steps', async () => {
    const { SidecarCaptionWriter } = await import('./sidecar-writer.js');
    const narrateSteps = [
      { text: 'Intro', duration: 1000 },
      { text: 'Main content', duration: 4000 },
    ];

    const entries = SidecarCaptionWriter.entriesFromNarrateSteps(narrateSteps);

    expect(entries.length).toBe(2);
    expect(entries[0].startTime).toBe(0);
    expect(entries[0].duration).toBe(1000);
    expect(entries[1].startTime).toBe(1000);
    expect(entries[1].duration).toBe(4000);
  });
});
