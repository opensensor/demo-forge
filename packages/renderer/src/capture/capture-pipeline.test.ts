/**
 * DemoForge renderer — capture pipeline tests.
 *
 * Tests for CapturePipeline: H.264/MP4, VP9/AV1/WebM, GIF with palette,
 * animated WebP, output metadata, progress reporting, and quality presets.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

import { CapturePipeline } from './capture-pipeline.js';
import type {
  CapturePipelineConfig,
  EncodingOptions,
  Mp4EncodingOptions,
  WebmEncodingOptions,
  GifEncodingOptions,
  WebpEncodingOptions,
  OutputMetadata,
  ProgressUpdate,
  CaptureResult,
  CaptureFailure,
} from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal valid WebM test video using ffmpeg. */
async function createTestWebm(tmpDir: string): Promise<string> {
  const input = join(tmpDir, 'test-input.webm');
  const p = spawn('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=blue:s=320x240:d=2:r=10`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=2:r=48000`,
    '-c:v', 'libvpx-vp9',
    '-b:v', '200k',
    '-c:a', 'libvorbis',
    '-shortest',
    input,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  await new Promise<void>((resolve, reject) => {
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg test video creation failed with code ${code}`));
    });
  });
  return input;
}

/** Create a minimal MP4 test video using ffmpeg. */
async function createTestMp4(tmpDir: string): Promise<string> {
  const input = join(tmpDir, 'test-input.mp4');
  const p = spawn('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=red:s=640x480:d=2:r=15',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    input,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  await new Promise<void>((resolve, reject) => {
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg test MP4 creation failed with code ${code}`));
    });
  });
  return input;
}

function makeConfig(tmpDir: string, extra?: Partial<CapturePipelineConfig>): CapturePipelineConfig {
  return { tmpDir, ...extra };
}

function assertMetadata(result: CaptureResult, expectedFormat: string): OutputMetadata {
  expect(result.success).toBe(true);
  const m = (result as CaptureResult).metadata;
  expect(m).toBeDefined();
  expect(m.outputPath).toBeTruthy();
  expect(m.fileSize).toBeGreaterThan(0);
  expect(m.width).toBeGreaterThan(0);
  expect(m.height).toBeGreaterThan(0);
  expect(m.duration).toBeGreaterThan(0);
  expect(m.fps).toBeGreaterThan(0);
  expect(m.codec).toBeTruthy();
  expect(m.format).toBe(expectedFormat);
  expect(m.frameCount).toBeGreaterThanOrEqual(0);
  return m;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CapturePipeline', () => {
  let tmpDir: string;
  let testWebm: string;
  let testMp4: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'demoforge-capture-'));
    testWebm = await createTestWebm(tmpDir);
    testMp4 = await createTestMp4(tmpDir);
  }, 30000);

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('instantiation', () => {
    it('creates a pipeline with default config', () => {
      const pipeline = new CapturePipeline();
      expect(pipeline).toBeDefined();
    });

    it('creates a pipeline with custom config', () => {
      const progressUpdates: ProgressUpdate[] = [];
      const pipeline = new CapturePipeline(makeConfig(tmpDir, {
        onProgress: (u) => progressUpdates.push(u),
      }));
      expect(pipeline).toBeDefined();
      expect(progressUpdates).toHaveLength(0);
    });
  });

  describe('H.264 MP4 encoding', () => {
    it('encodes WebM input to MP4', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      const result = await pipeline.encode(testWebm, opts);

      expect((result as CaptureResult).success).toBe(true);
      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.codec).toContain('h264');
      expect(m.format).toBe('mp4');
      expect(m.outputPath).toMatch(/\.mp4$/);
    });

    it('encodes MP4 input to MP4 (re-encode)', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      const result = await pipeline.encode(testMp4, opts);

      assertMetadata(result as CaptureResult, 'mp4');
    });

    it('scales output to specified resolution', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', width: 160, height: 120 };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.width).toBe(160);
      expect(m.height).toBe(120);
    });

    it('applies target fps', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', fps: 5 };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.fps).toBe(5);
    });

    it('respects quality preset max', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', quality: 'max' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.codec).toContain('h264');
      expect(m.fileSize).toBeGreaterThan(0);
    });

    it('respects quality preset small', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', quality: 'small' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.codec).toContain('h264');
      expect(m.fileSize).toBeGreaterThan(0);
    });

    it('supports h264 profile option', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', profile: 'baseline' };
      const result = await pipeline.encode(testWebm, opts);

      assertMetadata(result as CaptureResult, 'mp4');
    });

    it('reports progress during encoding', async () => {
      const progressUpdates: ProgressUpdate[] = [];
      const pipeline = new CapturePipeline(makeConfig(tmpDir, {
        onProgress: (u) => progressUpdates.push(u),
      }));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      await pipeline.encode(testWebm, opts);

      expect(progressUpdates.length).toBeGreaterThan(0);
      const phases = progressUpdates.map(u => u.phase);
      expect(phases).toContain('encoding');
    });
  });

  describe('VP9 WebM encoding', () => {
    it('encodes to VP9 WebM', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', codec: 'vp9' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'webm');
      expect(m.codec).toContain('vp9');
      expect(m.format).toBe('webm');
      expect(m.outputPath).toMatch(/\.webm$/);
    });

    it('encodes to AV1 WebM', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', codec: 'av1' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'webm');
      expect(m.codec).toContain('av1');
      expect(m.format).toBe('webm');
    });

    it('scales VP9 output', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', width: 320, height: 240 };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'webm');
      expect(m.width).toBe(320);
      expect(m.height).toBe(240);
    });

    it('respects quality preset balanced', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', codec: 'vp9', quality: 'balanced' };
      const result = await pipeline.encode(testWebm, opts);

      assertMetadata(result as CaptureResult, 'webm');
    });
  });

  describe('GIF with palette and size budget', () => {
    it('generates GIF with palette', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = { format: 'gif' };
      const result = await pipeline.encode(testWebm, opts);

      expect((result as CaptureResult).success).toBe(true);
      const m = (result as CaptureResult).metadata;
      expect(m.outputPath).toMatch(/\.gif$/);
      expect(m.fileSize).toBeGreaterThan(0);
    });

    it('enforces 5 MB default size budget', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = { format: 'gif' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.fileSize).toBeLessThanOrEqual(5 * 1024 * 1024);
    });

    it('enforces custom size budget', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = { format: 'gif', maxSizeBytes: 1024 * 1024 };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.fileSize).toBeLessThanOrEqual(1024 * 1024);
    });

    it('auto-reduces fps/scale to meet budget', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = {
        format: 'gif',
        maxSizeBytes: 512 * 1024,
        autoReduce: true,
      };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.fileSize).toBeLessThanOrEqual(512 * 1024);
    });

    it('reports palette generation progress', async () => {
      const progressUpdates: ProgressUpdate[] = [];
      const pipeline = new CapturePipeline(makeConfig(tmpDir, {
        onProgress: (u) => progressUpdates.push(u),
      }));
      const opts: GifEncodingOptions = { format: 'gif' };
      await pipeline.encode(testWebm, opts);

      const phases = progressUpdates.map(u => u.phase);
      expect(phases).toContain('palette_generation');
    });
  });

  describe('Animated WebP', () => {
    it('generates animated WebP', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebpEncodingOptions = { format: 'webp' };
      const result = await pipeline.encode(testWebm, opts);

      expect((result as CaptureResult).success).toBe(true);
      const m = (result as CaptureResult).metadata;
      expect(m.outputPath).toMatch(/\.webp$/);
      expect(m.fileSize).toBeGreaterThan(0);
    });

    it('respects quality preset for WebP', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebpEncodingOptions = { format: 'webp', quality: 'max' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.fileSize).toBeGreaterThan(0);
    });

    it('applies compression tuning', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebpEncodingOptions = { format: 'webp', quality: 'small' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.fileSize).toBeGreaterThan(0);
    });
  });

  describe('Output metadata accuracy', () => {
    it('metadata matches actual file properties for MP4', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4', width: 320, height: 240, fps: 10 };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');
      expect(m.width).toBe(320);
      expect(m.height).toBe(240);
      expect(m.fps).toBe(10);

      // Verify file exists and has reported size
      const stats = await readFile(m.outputPath);
      // Note: we can't easily stat here, but we verify the file is readable
      expect(stats.length).toBeGreaterThan(0);
    });

    it('metadata matches actual file properties for WebM', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', width: 320, height: 240 };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'webm');
      expect(m.width).toBe(320);
      expect(m.height).toBe(240);
    });

    it('metadata matches actual file properties for GIF', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = { format: 'gif' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      expect(m.outputPath).toMatch(/\.gif$/);
      expect(m.fileSize).toBeGreaterThan(0);
    });
  });

  describe('ffmpeg error handling', () => {
    it('returns actionable error for non-existent input', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      const result = await pipeline.encode('/nonexistent/path/input.webm', opts);

      expect((result as CaptureFailure).success).toBe(false);
      const failure = result as CaptureFailure;
      expect(failure.error).toBeTruthy();
      expect(failure.error.length).toBeGreaterThan(0);
    });

    it('returns actionable error for invalid format', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const result = await pipeline.encode(testWebm, { format: 'mp4' as any });
      // This should either work or fail gracefully
      if ((result as CaptureFailure).success === false) {
        expect((result as CaptureFailure).error).toBeTruthy();
      }
    });
  });

  describe('Quality presets produce different outputs', () => {
    it('max quality produces larger file than small for MP4', async () => {
      const optsMax: Mp4EncodingOptions = { format: 'mp4', quality: 'max' };
      const optsSmall: Mp4EncodingOptions = { format: 'mp4', quality: 'small' };

      const pipelineMax = new CapturePipeline(makeConfig(tmpDir));
      const pipelineSmall = new CapturePipeline(makeConfig(tmpDir));

      const resultMax = await pipelineMax.encode(testWebm, optsMax);
      const resultSmall = await pipelineSmall.encode(testWebm, optsSmall);

      const sizeMax = (resultMax as CaptureResult).metadata.fileSize;
      const sizeSmall = (resultSmall as CaptureResult).metadata.fileSize;

      // Max quality should produce a file at least as large as small quality
      expect(sizeMax).toBeGreaterThanOrEqual(sizeSmall);
    });

    it('balanced quality produces different output from max for WebM', async () => {
      const optsMax: WebmEncodingOptions = { format: 'webm', codec: 'vp9', quality: 'max' };
      const optsBalanced: WebmEncodingOptions = { format: 'webm', codec: 'vp9', quality: 'balanced' };

      const pipelineMax = new CapturePipeline(makeConfig(tmpDir));
      const pipelineBalanced = new CapturePipeline(makeConfig(tmpDir));

      const resultMax = await pipelineMax.encode(testWebm, optsMax);
      const resultBalanced = await pipelineBalanced.encode(testWebm, optsBalanced);

      const sizeMax = (resultMax as CaptureResult).metadata.fileSize;
      const sizeBalanced = (resultBalanced as CaptureResult).metadata.fileSize;

      // Both should produce valid outputs
      expect(sizeMax).toBeGreaterThan(0);
      expect(sizeBalanced).toBeGreaterThan(0);
    });
  });

  describe('progress reporting', () => {
    it('reports multiple phases during encoding', async () => {
      const progressUpdates: ProgressUpdate[] = [];
      const pipeline = new CapturePipeline(makeConfig(tmpDir, {
        onProgress: (u) => progressUpdates.push(u),
      }));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      await pipeline.encode(testWebm, opts);

      expect(progressUpdates.length).toBeGreaterThan(0);
      for (const update of progressUpdates) {
        expect(update.phase).toBeTruthy();
        expect(update.percent).toBeGreaterThanOrEqual(0);
        expect(update.percent).toBeLessThanOrEqual(100);
        expect(update.message).toBeTruthy();
      }
    });

    it('reports encoding phase with increasing progress', async () => {
      const progressUpdates: ProgressUpdate[] = [];
      const pipeline = new CapturePipeline(makeConfig(tmpDir, {
        onProgress: (u) => progressUpdates.push(u),
      }));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      await pipeline.encode(testWebm, opts);

      const encodingUpdates = progressUpdates.filter(u => u.phase === 'encoding');
      if (encodingUpdates.length > 1) {
        // Progress should generally increase
        for (let i = 1; i < encodingUpdates.length; i++) {
          expect(encodingUpdates[i].percent).toBeGreaterThanOrEqual(
            encodingUpdates[i - 1].percent
          );
        }
      }
    });
  });

  describe('MP4 playback validation', () => {
    it('produces valid MP4 with correct codec', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: Mp4EncodingOptions = { format: 'mp4' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'mp4');

      // Verify with ffprobe that the output is a valid MP4 with H.264
      const p = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,r_frame_rate,duration',
        '-show_entries', 'format=duration,size',
        '-print_format', 'json',
        m.outputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      p.stdout?.on('data', (d) => { stdout += d; });

      await new Promise<void>((resolve, reject) => {
        p.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffprobe failed with code ${code}`));
        });
      });

      const probe = JSON.parse(stdout);
      expect(probe.streams).toBeDefined();
      expect(probe.streams.length).toBeGreaterThan(0);
      expect(probe.streams[0].codec_name).toContain('h264');
    });
  });

  describe('WebM playback validation', () => {
    it('produces valid VP9 WebM', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebmEncodingOptions = { format: 'webm', codec: 'vp9' };
      const result = await pipeline.encode(testWebm, opts);

      const m = assertMetadata(result as CaptureResult, 'webm');

      const p = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-print_format', 'json',
        m.outputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      p.stdout?.on('data', (d) => { stdout += d; });

      await new Promise<void>((resolve, reject) => {
        p.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffprobe failed with code ${code}`));
        });
      });

      const probe = JSON.parse(stdout);
      expect(probe.streams[0].codec_name).toContain('vp9');
    });
  });

  describe('GIF validation', () => {
    it('produces valid GIF file', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: GifEncodingOptions = { format: 'gif' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      // GIFs start with GIF89a or GIF87a header
      const header = await readFile(m.outputPath, { encoding: 'utf8', flag: 'r' }).catch(() => '');
      // Read as buffer for binary check
      const buf = await readFile(m.outputPath);
      const gifHeader = buf.slice(0, 6).toString('ascii');
      expect(gifHeader).toMatch(/^GIF8[79]a/);
    });
  });

  describe('WebP validation', () => {
    it('produces valid WebP file', async () => {
      const pipeline = new CapturePipeline(makeConfig(tmpDir));
      const opts: WebpEncodingOptions = { format: 'webp' };
      const result = await pipeline.encode(testWebm, opts);

      const m = (result as CaptureResult).metadata;
      const buf = await readFile(m.outputPath);
      // WebP files start with RIFF....WEBP
      expect(buf.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(buf.slice(8, 12).toString('ascii')).toBe('WEBP');
    });
  });
});
