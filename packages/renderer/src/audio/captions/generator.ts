/**
 * DemoForge renderer — CaptionGenerator for SRT and VTT.
 *
 * Generates SRT and WebVTT caption files from caption entries with timing
 * aligned to TTS narration or narrate step pauses. Supports configurable
 * caption styling (font, size, position, background).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  CaptionEntry,
  CaptionStyle,
  DefaultCaptionStyle,
  CaptionGenerationResult,
  CaptionFormat,
  SubtitleFilterOutput,
} from './types.js';

// ─── Default caption style ────────────────────────────────────────────────────

const DEFAULT_STYLE: Required<CaptionStyle> = {
  fontFamily: 'Arial',
  fontSize: 24,
  fontColor: '#FFFFFF',
  backgroundColor: '#00000080',
  horizontalAlign: 'center',
  verticalAlign: 'bottom',
  borderStyle: 'box',
  borderColor: '#000000',
  borderWidth: 2,
};

// ─── Filter helpers ───────────────────────────────────────────────────────────

/** Escape a file path for use inside an ffmpeg filter graph (\ : ' , ; [ ]). */
function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Convert a #RRGGBB or #RRGGBBAA hex color to ASS &HAABBGGRR format.
 * ASS alpha is inverted: 00 = opaque, FF = fully transparent.
 */
function hexToAssColor(hex: string): string {
  const raw = hex.replace('#', '');
  const r = raw.slice(0, 2) || '00';
  const g = raw.slice(2, 4) || '00';
  const b = raw.slice(4, 6) || '00';
  const alpha = raw.length >= 8 ? 255 - parseInt(raw.slice(6, 8), 16) : 0;
  const a = alpha.toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

// ─── CaptionGenerator ─────────────────────────────────────────────────────────

export class CaptionGenerator {
  private style: DefaultCaptionStyle;
  private entries: CaptionEntry[] = [];
  private outputDir: string;

  constructor(options?: { style?: Partial<CaptionStyle>; outputDir?: string }) {
    this.style = { ...DEFAULT_STYLE, ...options?.style };
    this.outputDir = options?.outputDir ?? process.cwd();
  }

  /** Add a single caption entry. */
  addEntry(entry: Omit<CaptionEntry, 'index'>): this {
    const nextIndex = this.entries.length + 1;
    this.entries.push({ ...entry, index: nextIndex });
    return this;
  }

  /** Add multiple caption entries. */
  addEntries(entries: Omit<CaptionEntry, 'index'>[]): this {
    for (const entry of entries) {
      this.addEntry(entry);
    }
    return this;
  }

  /** Clear all entries. */
  clear(): this {
    this.entries = [];
    return this;
  }

  /** Get all entries. */
  getEntries(): Readonly<CaptionEntry[]> {
    return this.entries;
  }

  /** Get the number of entries. */
  getEntryCount(): number {
    return this.entries.length;
  }

  /** Get the current style. */
  getStyle(): Readonly<DefaultCaptionStyle> {
    return this.style;
  }

  /** Update the style. */
  setStyle(style: Partial<CaptionStyle>): this {
    this.style = { ...this.style, ...style };
    return this;
  }

  /**
   * Generate SRT content from entries.
   * Format:
   *   1
   *   00:00:01,000 --> 00:00:03,500
   *   Caption text here
   *
   *   2
   *   ...
   */
  generateSrt(): string {
    if (this.entries.length === 0) {
      return '';
    }

    const blocks: string[] = [];

    for (const entry of this.entries) {
      const start = this.msToSrtTimestamp(entry.startTime);
      const end = this.msToSrtTimestamp(entry.startTime + entry.duration);
      const text = this.escapeSrtText(entry.text);

      blocks.push(`${entry.index}\n${start} --> ${end}\n${text}`);
    }

    return blocks.join('\n\n') + '\n';
  }

  /**
   * Generate WebVTT content from entries.
   * Format:
   *   WEBVTT
   *
   *   1
   *   00:00:01.000 --> 00:00:03.500
   *   Caption text here
   *
   *   2
   *   ...
   */
  generateVtt(): string {
    if (this.entries.length === 0) {
      return 'WEBVTT\n\n';
    }

    const lines: string[] = ['WEBVTT', ''];

    for (const entry of this.entries) {
      const start = this.msToVttTimestamp(entry.startTime);
      const end = this.msToVttTimestamp(entry.startTime + entry.duration);
      const text = entry.text;

      lines.push(`${entry.index}`);
      lines.push(`${start} --> ${end}`);
      lines.push(text);
      lines.push('');
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generate a caption file of the specified format and write to disk.
   * Returns the file path.
   */
  write(format: CaptionFormat, filePath?: string): string {
    const content = format === 'srt' ? this.generateSrt() : this.generateVtt();
    const targetPath = filePath ?? this.getDefaultPath(format);
    const dir = path.dirname(targetPath);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');

    return targetPath;
  }

  /**
   * Generate both SRT and VTT files and write to the output directory.
   * Returns a CaptionGenerationResult.
   */
  writeSidecarFiles(basePath?: string): CaptionGenerationResult {
    const base = basePath ?? path.join(this.outputDir, 'captions');
    const srtPath = `${base}.srt`;
    const vttPath = `${base}.vtt`;

    fs.mkdirSync(path.dirname(srtPath), { recursive: true });

    fs.writeFileSync(srtPath, this.generateSrt(), 'utf-8');
    fs.writeFileSync(vttPath, this.generateVtt(), 'utf-8');

    return {
      success: true,
      srtPath,
      vttPath,
      captionCount: this.entries.length,
    };
  }

  /**
   * Build an FFmpeg subtitle filter argument for burned-in captions.
   * Uses the subtitles filter with configurable styling via force_style.
   * The SRT file is consumed by the filter itself (not as a second input).
   */
  buildSubFilter(inputPath: string, srtPath: string): SubtitleFilterOutput {
    const filterArg = this.buildSubtitlesFilter(srtPath);
    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      '-filter_complex', filterArg,
      '-c:v', 'libx264',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-map', '[v]',
      '-map', '0:a?',
      srtPath.replace(/\.srt$/, '_burned.mp4'),
    ];

    return { filterArg, ffmpegArgs };
  }

  /**
   * Build an FFmpeg subtitle overlay using the native subtitles muxer.
   * Simpler approach: embeds the SRT as a subtitle stream.
   */
  buildSubMuxerArgs(inputPath: string, srtPath: string): string[] {
    return [
      '-y',
      '-i', inputPath,
      '-i', srtPath,
      '-c:v', 'libx264',
      '-c:a', 'copy',
      '-c:s', 'mov_text',
      '-movflags', '+faststart',
      srtPath.replace(/\.srt$/, '_subtitled.mp4'),
    ];
  }

  // ─── Private methods ────────────────────────────────────────────────────

  private msToSrtTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const millis = Math.floor(ms % 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  private msToVttTimestamp(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const millis = Math.floor(ms % 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  private escapeSrtText(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Build the subtitles filter expression. The SRT path is escaped for the
   * filter graph and the caption style is mapped to ASS force_style overrides.
   */
  private buildSubtitlesFilter(srtPath: string): string {
    const escapedSrt = escapeFilterPath(srtPath);
    const forceStyle = [
      `FontName=${this.style.fontFamily}`,
      `FontSize=${this.style.fontSize}`,
      `PrimaryColour=${hexToAssColor(this.style.fontColor)}`,
      `BackColour=${hexToAssColor(this.style.backgroundColor)}`,
      `OutlineColour=${hexToAssColor(this.style.borderColor)}`,
      `Outline=${this.style.borderWidth}`,
      `BorderStyle=${this.style.borderStyle === 'box' ? 3 : 1}`,
      `Alignment=${this.resolveAssAlignment()}`,
    ].join(',');

    return `[0:v]subtitles=filename=${escapedSrt}:force_style='${forceStyle}'[v]`;
  }

  /**
   * Map horizontal/vertical alignment to an ASS numpad alignment value:
   * 1-3 bottom, 4-6 middle, 7-9 top (left/center/right within each row).
   */
  private resolveAssAlignment(): number {
    const hAlign = this.style.horizontalAlign;
    const vAlign = this.style.verticalAlign;

    const column = hAlign === 'left' ? 1 : hAlign === 'right' ? 3 : 2;

    let row = 0; // bottom
    if (vAlign === 'top') {
      row = 6;
    } else if (vAlign === 'middle') {
      row = 3;
    } else if (typeof vAlign === 'string' && vAlign.endsWith('%')) {
      const pct = parseInt(vAlign, 10);
      row = pct < 33 ? 6 : pct <= 66 ? 3 : 0;
    }

    return row + column;
  }

  private getDefaultPath(format: CaptionFormat): string {
    const ext = format === 'srt' ? 'srt' : 'vtt';
    return path.join(this.outputDir, `captions.${ext}`);
  }
}
