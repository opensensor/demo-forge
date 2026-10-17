/**
 * DemoForge — end-to-end render of one Demo Script into deliverables.
 *
 * prepare narration → replay (recorded) → post-production → manifest.
 * Shared by the CLI `render` command, Studio, and scripted examples.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DemoScript, NarrationMode } from '@demoforge/core';
import { BrowserSession } from '@demoforge/browser';

import type { TtsBackendName } from '../audio/tts/types.js';
import { prepareNarration } from '../narration/narration.js';
import { Renderer } from '../replay/renderer.js';
import type { RenderResult } from '../replay/types.js';
import { produceDeliverables, type DeliverableFormat, type ProduceResult } from './produce.js';

export interface RenderDemoOptions {
  /** Directory for this demo's outputs. */
  outputDir: string;
  /** Overrides the script's narration_mode. */
  narrationMode?: NarrationMode;
  ttsBackend?: TtsBackendName;
  voice?: string;
  /** Record and encode video. When false only screenshots are produced. Default: true. */
  video?: boolean;
  formats?: DeliverableFormat[];
  burnCaptions?: boolean;
  /** Output video width (height follows). Default: viewport width. */
  videoWidth?: number;
  stepTimeout?: number;
  globalTimeout?: number;
  onLog?: (message: string) => void;
}

export interface RenderDemoResult {
  demo: string;
  render: RenderResult;
  produced?: ProduceResult;
  rawVideo?: string;
  manifestPath: string;
}

const BROWSER_ARGS = [
  '--disable-background-networking',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-extensions',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
];

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

export async function renderDemo(script: DemoScript, options: RenderDemoOptions): Promise<RenderDemoResult> {
  const log = options.onLog ?? (() => {});
  const video = options.video ?? true;
  const outputDir = options.outputDir;
  const rawDir = join(outputDir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const viewport = { width: script.viewport.width, height: script.viewport.height };
  const narrationMode = options.narrationMode ?? script.narration_mode;

  const narration = video
    ? await prepareNarration(script, {
        mode: narrationMode,
        backend: options.ttsBackend,
        voice: options.voice,
        audioDir: join(outputDir, '..', '.audio-cache'),
        onLog: log,
      })
    : undefined;

  const browser = new BrowserSession({
    headless: true,
    headed: false,
    forbidHostDisplay: true,
    viewport,
    timeout: 15000,
    args: BROWSER_ARGS,
    ...(video ? { recordVideo: { dir: rawDir, size: { width: even(viewport.width), height: even(viewport.height) } } } : {}),
  });

  const renderer = new Renderer(
    video ? script : { ...script, cursor: false },
    {
      outputDir,
      stepTimeout: options.stepTimeout ?? 20000,
      globalTimeout: options.globalTimeout ?? 15 * 60 * 1000,
      narration,
      onLog: log,
    },
    browser,
  );

  const render = await renderer.render();
  await browser.close().catch(() => {});

  let rawVideo: string | undefined;
  let produced: ProduceResult | undefined;

  if (video && browser.videoPath && existsSync(browser.videoPath)) {
    rawVideo = join(rawDir, `${script.demo}.webm`);
    copyFileSync(browser.videoPath, rawVideo);

    if (render.status === 'success') {
      produced = await produceDeliverables({
        rawVideo,
        outputDir,
        name: script.demo,
        trimStartMs: render.contentStartMs,
        narration: narrationMode === 'none' ? [] : render.narration,
        formats: options.formats ?? ['mp4', 'gif'],
        burnCaptions: options.burnCaptions ?? narrationMode === 'captions',
        width: options.videoWidth,
        onLog: log,
      });
    } else {
      log(`render ${render.status} — keeping raw recording for debugging, skipping encode`);
    }
  }

  const manifestPath = join(outputDir, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        demo: script.demo,
        title: script.title,
        status: render.status,
        renderedAt: new Date().toISOString(),
        durationMs: render.totalDuration,
        outputs: produced?.outputs ?? {},
        captions: produced?.captions,
        screenshots: render.screenshots ?? [],
        narration: (render.narration ?? []).map(({ text, atMs, durationMs }) => ({
          text,
          atMs: Math.max(0, atMs - (render.contentStartMs ?? 0)),
          durationMs,
        })),
        errors: [
          ...(produced?.errors ?? []),
          ...render.steps
            .filter((s) => s.status === 'failure' || s.status === 'timeout')
            .map((s) => `step ${s.stepIndex} (${s.stepType}): ${'error' in s ? s.error : `timeout after ${'timeoutMs' in s ? s.timeoutMs : '?'}ms`}`),
        ],
      },
      null,
      2,
    ),
  );

  return { demo: script.demo, render, produced, rawVideo, manifestPath };
}
