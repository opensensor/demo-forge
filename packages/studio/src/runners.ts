/**
 * DemoForge Studio — the real explore/render implementations.
 *
 * Kept separate from the HTTP layer so tests can inject fakes and so the
 * server module stays free of heavyweight imports at request time.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import {
  LlmClient,
  createExplorerLlmAdapter,
  ExplorerAgent,
  type DemoScript,
} from "@demoforge/core";
import { BrowserSession } from "@demoforge/browser";
import { Renderer, CapturePipeline } from "@demoforge/renderer";
import type { Run, RunManager, RunRequest } from "./runs.js";

export interface ExploreOutcome {
  success: boolean;
  stopReason: string;
  script: DemoScript;
  videoPath?: string;
}

export type ExploreRunner = (
  request: RunRequest,
  outputDir: string,
  onLog: (message: string) => void,
) => Promise<ExploreOutcome>;

export type RenderRunner = (
  script: DemoScript,
  outputDir: string,
  onLog: (message: string) => void,
) => Promise<{ status: string; videoPath?: string; screenshots: string[] }>;

const MAX_STUDIO_VIDEO_SIZE = { width: 1280, height: 720 };
const STUDIO_FPS = 24;
const STUDIO_FFMPEG_THREADS = 2;

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function fitVideoSize(viewport: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_STUDIO_VIDEO_SIZE.width / viewport.width,
    MAX_STUDIO_VIDEO_SIZE.height / viewport.height,
  );
  return {
    width: even(viewport.width * scale),
    height: even(viewport.height * scale),
  };
}

function encodeRecordedVideo(
  rawVideoPath: string,
  outputDir: string,
  baseName: string,
  videoSize: { width: number; height: number },
  onLog: (message: string) => void,
): Promise<string | undefined> {
  const rawWebm = join(outputDir, "videos", `${baseName}.webm`);
  copyFileSync(rawVideoPath, rawWebm);
  onLog(
    `encoding ${baseName}.mp4 at ${videoSize.width}x${videoSize.height} ${STUDIO_FPS}fps (${STUDIO_FFMPEG_THREADS} threads)`,
  );
  const pipeline = new CapturePipeline();
  return pipeline
    .encode(rawWebm, {
      format: "mp4",
      width: videoSize.width,
      height: videoSize.height,
      fps: STUDIO_FPS,
      quality: "small",
      threads: STUDIO_FFMPEG_THREADS,
      outputPath: join(outputDir, "videos", `${baseName}.mp4`),
    })
    .then((encoded) => {
      if (encoded.success) {
        onLog(`encoded ${baseName}.mp4 (${encoded.metadata.fileSize} bytes)`);
        return encoded.metadata.outputPath;
      }
      onLog(`${baseName}.mp4 encode failed: ${encoded.error} — keeping webm`);
      return rawWebm;
    });
}

export const realExploreRunner: ExploreRunner = async (request, outputDir, onLog) => {
  mkdirSync(join(outputDir, "videos"), { recursive: true });
  const videoSize = fitVideoSize(request.viewport);
  const httpClient = new LlmClient({
    baseURL: request.llmUrl,
    model: request.model,
    timeout: 300000,
    maxRetries: 2,
  });

  const browser = new BrowserSession({
    headless: true,
    headed: false,
    forbidHostDisplay: true,
    viewport: request.viewport,
    timeout: 8000,
    args: [
      "--disable-background-networking",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-extensions",
      "--mute-audio",
    ],
    recordVideo: { dir: join(outputDir, "videos"), size: videoSize },
  });

  let outcome: ExploreOutcome | undefined;
  try {
    const agent = new ExplorerAgent({
      url: request.url,
      goal: request.goal,
      maxSteps: request.maxSteps,
      maxTime: 600000,
      viewport: { ...request.viewport, scale: 1 },
      guardrails: {
        allowedOrigins: [request.url],
        destructiveButtonPatterns: request.denylist,
      },
      reporter: {
        report(event) {
          if (event.type === "turn_start") {
            onLog(`Turn ${event.turn} — thinking...`);
          } else if (event.message) {
            onLog(`${event.type}: ${event.message}`);
          }
        },
      },
      llmClient: createExplorerLlmAdapter(httpClient, {
        temperature: 0.2,
        maxTokens: 8192,
      }),
      scriptTemplate: {
        title: "DemoForge Studio run",
        narration_mode: "captions",
      },
      requireConfirmation: false,
      browser,
    });

    const result = await agent.run();
    outcome = {
      success: result.success,
      stopReason: result.stopReason,
      script: result.script,
    };
    return outcome;
  } finally {
    await browser.close().catch(() => {});
    if (outcome && browser.videoPath && existsSync(browser.videoPath)) {
      try {
        outcome.videoPath = await encodeRecordedVideo(
          browser.videoPath,
          outputDir,
          "exploration",
          videoSize,
          onLog,
        );
      } catch (err) {
        onLog(`exploration video capture failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
};

export const realRenderRunner: RenderRunner = async (script, outputDir, onLog) => {
  mkdirSync(join(outputDir, "videos"), { recursive: true });

  const viewport = {
    width: script.viewport?.width ?? 1280,
    height: script.viewport?.height ?? 720,
  };
  const videoSize = fitVideoSize(viewport);

  const browser = new BrowserSession({
    headless: true,
    headed: false,
    forbidHostDisplay: true,
    viewport,
    args: [
      "--disable-background-networking",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-extensions",
      "--mute-audio",
    ],
    recordVideo: { dir: join(outputDir, "videos"), size: videoSize },
  });

  let result;
  try {
    const renderer = new Renderer(
      script,
      { outputDir, stepTimeout: 20000, globalTimeout: 300000 },
      browser,
    );
    result = await renderer.render();
  } finally {
    await browser.close().catch(() => {});
  }

  for (const step of result.steps) {
    const error = "error" in step && step.error ? ` — ${step.error}` : "";
    onLog(`step ${step.stepIndex} ${step.stepType}: ${step.status}${error}`);
  }

  const screenshotsDir = join(outputDir, "screenshots");
  const screenshots = existsSync(screenshotsDir)
    ? readdirSync(screenshotsDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => join(screenshotsDir, f))
    : [];

  let videoPath: string | undefined;
  if (browser.videoPath && existsSync(browser.videoPath)) {
    videoPath = await encodeRecordedVideo(browser.videoPath, outputDir, "demo", videoSize, onLog);
  }

  return { status: result.status, videoPath, screenshots };
};

/** Persist the assembled script into the run's output directory. */
export function saveScript(run: Run, manager: RunManager): string {
  mkdirSync(run.outputDir, { recursive: true });
  const scriptPath = join(run.outputDir, "demo-script.json");
  writeFileSync(scriptPath, JSON.stringify(run.script, null, 2));
  manager.emit(run, {
    type: "artifact",
    artifact: { kind: "script", path: scriptPath },
  });
  return scriptPath;
}
