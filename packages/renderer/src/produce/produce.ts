/**
 * DemoForge post-production — turn a raw replay recording into deliverables.
 *
 * - trims the blank lead-in Playwright records before the first page loads
 * - mixes narration clips onto an audio track at the moments they were spoken
 * - writes SRT/VTT caption sidecars, optionally burning captions into the video
 * - encodes the final MP4, plus GIF/WebM derivatives
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CaptionGenerator } from '../audio/captions/generator.js';
import { CapturePipeline } from '../capture/capture-pipeline.js';
import type { NarrationEvent } from '../replay/types.js';

export type DeliverableFormat = 'mp4' | 'gif' | 'webm';

export interface ProduceOptions {
  /** Raw recording from the replay (Playwright WebM). */
  rawVideo: string;
  outputDir: string;
  /** Base filename for outputs (no extension). */
  name: string;
  /** Milliseconds to cut from the start of the raw recording. */
  trimStartMs?: number;
  /** Narration as it happened during replay (times relative to raw video start). */
  narration?: NarrationEvent[];
  formats?: DeliverableFormat[];
  /** Burn captions into the MP4 (in addition to writing sidecars). */
  burnCaptions?: boolean;
  /** Output width; height follows the aspect ratio. Default: source width. */
  width?: number;
  fps?: number;
  /** GIF width (GIFs get large quickly). Default: 960. */
  gifWidth?: number;
  ffmpegPath?: string;
  onLog?: (message: string) => void;
}

export interface ProduceResult {
  outputs: Partial<Record<DeliverableFormat, string>>;
  captions?: { srt: string; vtt: string };
  errors: string[];
}

// libass styling for burned captions: white text on a translucent box.
const CAPTION_STYLE = [
  'FontName=DejaVu Sans',
  'FontSize=13',
  'PrimaryColour=&H00FFFFFF',
  'OutlineColour=&H90101010',
  'BackColour=&H90101010',
  'BorderStyle=3',
  'Outline=6',
  'Shadow=0',
  'MarginV=22',
  'Alignment=2',
].join(',');

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().split('\n').slice(-5).join(' | ')}`));
    });
  });
}

/** Caption entries for the trimmed timeline. */
export function captionEntries(
  narration: NarrationEvent[],
  trimStartMs: number,
): Array<{ startTime: number; duration: number; text: string }> {
  return narration
    .map((event) => ({
      startTime: Math.max(0, event.atMs - trimStartMs),
      duration: Math.max(500, event.durationMs),
      text: event.text,
    }))
    .sort((a, b) => a.startTime - b.startTime)
    .map((entry, i, all) => {
      // Never overlap the next caption.
      const next = all[i + 1];
      const duration = next ? Math.min(entry.duration, next.startTime - entry.startTime - 50) : entry.duration;
      return { ...entry, duration: Math.max(300, duration) };
    });
}

export async function produceDeliverables(options: ProduceOptions): Promise<ProduceResult> {
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg';
  const log = options.onLog ?? (() => {});
  const formats = options.formats ?? ['mp4'];
  const trimStartMs = Math.max(0, options.trimStartMs ?? 0);
  const narration = options.narration ?? [];
  const fps = options.fps ?? 30;
  const result: ProduceResult = { outputs: {}, errors: [] };

  fs.mkdirSync(options.outputDir, { recursive: true });
  const base = path.join(options.outputDir, options.name);

  // ── Captions ────────────────────────────────────────────────────────────
  const entries = captionEntries(narration, trimStartMs);
  if (entries.length > 0) {
    const captions = new CaptionGenerator({ outputDir: options.outputDir });
    captions.addEntries(entries);
    result.captions = {
      srt: captions.write('srt', `${base}.srt`),
      vtt: captions.write('vtt', `${base}.vtt`),
    };
  }

  // ── Master MP4 (video + narration audio + optional burned captions) ──────
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  args.push('-ss', (trimStartMs / 1000).toFixed(3), '-i', options.rawVideo);

  const spoken = narration.filter((e) => e.audioPath && fs.existsSync(e.audioPath));
  for (const event of spoken) {
    args.push('-i', event.audioPath as string);
  }

  const videoChain: string[] = [`fps=${fps}`];
  if (options.width) {
    videoChain.push(`scale=${options.width}:-2:flags=lanczos`);
  }
  if (options.burnCaptions && result.captions) {
    videoChain.push(
      `subtitles=filename='${escapeFilterValue(result.captions.srt)}':force_style='${CAPTION_STYLE}'`,
    );
  }
  const filters = [`[0:v]${videoChain.join(',')}[vout]`];

  if (spoken.length > 0) {
    spoken.forEach((event, i) => {
      const delay = Math.max(0, Math.round(event.atMs - trimStartMs));
      filters.push(`[${i + 1}:a]aresample=48000,adelay=${delay}|${delay}[a${i}]`);
    });
    const mixInputs = spoken.map((_e, i) => `[a${i}]`).join('');
    filters.push(`${mixInputs}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,apad[aout]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (spoken.length > 0) {
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k', '-shortest');
  }
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  const mp4Path = `${base}.mp4`;
  args.push(mp4Path);

  log(`encoding ${path.basename(mp4Path)} (${spoken.length} narration clip(s)${options.burnCaptions ? ', burned captions' : ''})`);
  try {
    await runFfmpeg(ffmpeg, args);
    result.outputs.mp4 = mp4Path;
  } catch (err) {
    result.errors.push(`mp4: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // ── Derivatives ─────────────────────────────────────────────────────────
  const pipeline = new CapturePipeline({ ffmpegPath: ffmpeg });
  if (formats.includes('gif')) {
    log(`encoding ${options.name}.gif`);
    const gif = await pipeline.encode(mp4Path, {
      format: 'gif',
      width: options.gifWidth ?? 960,
      fps: 12,
      quality: 'balanced',
      outputPath: `${base}.gif`,
    });
    if (gif.success) result.outputs.gif = gif.metadata.outputPath;
    else result.errors.push(`gif: ${gif.error}`);
  }
  if (formats.includes('webm')) {
    log(`encoding ${options.name}.webm`);
    const webm = await pipeline.encode(mp4Path, {
      format: 'webm',
      quality: 'balanced',
      outputPath: `${base}.webm`,
    });
    if (webm.success) result.outputs.webm = webm.metadata.outputPath;
    else result.errors.push(`webm: ${webm.error}`);
  }

  return result;
}
