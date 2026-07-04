/**
 * DemoForge Studio — server tests.
 *
 * Exercises the HTTP API with injected fake explore/render runners so no
 * LLM or browser is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DemoScript } from "@demoforge/core";
import { StudioServer } from "./server.js";
import type { ExploreRunner, RenderRunner } from "./runners.js";

const SCRIPT: DemoScript = {
  demo: "test",
  title: "Test Demo",
  url: "http://example.test",
  viewport: { width: 1280, height: 720, scale: 1 },
  narration_mode: "none",
  steps: [{ goto: "http://example.test" }, { done: true }],
};

const fakeExplore: ExploreRunner = async (_request, _outputDir, onLog) => {
  onLog("turn 1: goto");
  onLog("turn 2: done");
  return { success: true, stopReason: "done", script: SCRIPT };
};

const fakeRender: RenderRunner = async (_script, outputDir, onLog) => {
  const shotsDir = join(outputDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });
  const shot = join(shotsDir, "01-test.png");
  writeFileSync(shot, Buffer.from("png"));
  const videosDir = join(outputDir, "videos");
  mkdirSync(videosDir, { recursive: true });
  const video = join(videosDir, "demo.mp4");
  writeFileSync(video, Buffer.from("mp4"));
  onLog("rendered");
  return { status: "success", videoPath: video, screenshots: [shot] };
};

const VALID_RUN = {
  url: "http://127.0.0.1:9999",
  goal: "Show the dashboard overview to a prospect",
  llmUrl: "http://127.0.0.1:8080",
  model: "test-model",
  maxSteps: 10,
  denylist: ["delete"],
};

async function waitForStatus(
  base: string,
  id: string,
  status: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${base}/api/runs/${id}`);
    const run = (await res.json()) as Record<string, unknown>;
    if (run.status === status || run.status === "failed") return run;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${status}, at ${run.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("StudioServer", () => {
  let server: StudioServer;
  let base: string;
  let outputRoot: string;

  beforeEach(async () => {
    outputRoot = join(tmpdir(), `studio-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    server = new StudioServer({
      port: 0,
      outputRoot,
      exploreRunner: fakeExplore,
      renderRunner: fakeRender,
    });
    await server.start();
    base = server.url;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("serves the studio UI at /", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("DemoForge Studio");
    expect(html).toContain("Objectives");
    expect(html).toContain("Download video");
    expect(html).not.toContain('createElement("video")');
  });

  it("rejects a run without a goal", async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://x.test", goal: "short" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("goal");
  });

  it("rejects a run with a non-http url", async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_RUN, url: "file:///etc/passwd" }),
    });
    expect(res.status).toBe(400);
  });

  it("runs exploration and exposes the assembled script", async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_RUN),
    });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };

    const run = await waitForStatus(base, id, "explored");
    expect(run.status).toBe("explored");
    expect((run.script as DemoScript).steps).toHaveLength(2);
    const artifacts = run.artifacts as Array<{ kind: string; href: string }>;
    expect(artifacts.some((a) => a.kind === "script")).toBe(true);
  });

  it("keeps a blank model unset so the LLM server default is used", async () => {
    let capturedModel: string | undefined = "not-called";
    const captureExplore: ExploreRunner = async (request, _outputDir, onLog) => {
      capturedModel = request.model;
      return fakeExplore(request, _outputDir, onLog);
    };
    const modelServer = new StudioServer({
      port: 0,
      outputRoot: join(outputRoot, "blank-model"),
      exploreRunner: captureExplore,
      renderRunner: fakeRender,
      defaultModel: "configured-model",
    });
    await modelServer.start();
    try {
      const res = await fetch(`${modelServer.url}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...VALID_RUN, model: "" }),
      });
      const { id } = (await res.json()) as { id: string };
      await waitForStatus(modelServer.url, id, "explored");
      expect(capturedModel).toBeUndefined();
    } finally {
      await modelServer.stop();
    }
  });

  it("publishes a first-run exploration video when the explore runner records one", async () => {
    const videoExplore: ExploreRunner = async (_request, outputDir, onLog) => {
      const videosDir = join(outputDir, "videos");
      mkdirSync(videosDir, { recursive: true });
      const video = join(videosDir, "exploration.mp4");
      writeFileSync(video, Buffer.from("mp4"));
      onLog("captured exploration video");
      return { success: true, stopReason: "done", script: SCRIPT, videoPath: video };
    };
    const videoServer = new StudioServer({
      port: 0,
      outputRoot: join(outputRoot, "first-run-video"),
      exploreRunner: videoExplore,
      renderRunner: fakeRender,
    });
    await videoServer.start();
    try {
      const res = await fetch(`${videoServer.url}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_RUN),
      });
      const { id } = (await res.json()) as { id: string };
      const run = await waitForStatus(videoServer.url, id, "explored");
      const artifacts = run.artifacts as Array<{ kind: string; href: string }>;
      const video = artifacts.find((a) => a.kind === "video");
      expect(video).toBeDefined();
      expect(video!.href).toContain("exploration.mp4");
    } finally {
      await videoServer.stop();
    }
  });

  it("renders after exploration and serves artifacts", async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_RUN),
    });
    const { id } = (await res.json()) as { id: string };
    await waitForStatus(base, id, "explored");

    const renderRes = await fetch(`${base}/api/runs/${id}/render`, { method: "POST" });
    expect(renderRes.status).toBe(202);

    const run = await waitForStatus(base, id, "rendered");
    const artifacts = run.artifacts as Array<{ kind: string; href: string }>;
    const video = artifacts.find((a) => a.kind === "video");
    const shot = artifacts.find((a) => a.kind === "screenshot");
    expect(video).toBeDefined();
    expect(shot).toBeDefined();

    const videoRes = await fetch(`${base}${video!.href}`);
    expect(videoRes.status).toBe(200);
    expect(videoRes.headers.get("content-type")).toBe("video/mp4");
    expect(videoRes.headers.get("content-disposition")).toContain("attachment");

    const shotRes = await fetch(`${base}${shot!.href}`);
    expect(shotRes.status).toBe(200);
  });

  it("refuses to render before exploration finishes", async () => {
    const slowExplore: ExploreRunner = async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { success: true, stopReason: "done", script: SCRIPT };
    };
    const slowServer = new StudioServer({
      port: 0,
      outputRoot: join(outputRoot, "slow"),
      exploreRunner: slowExplore,
      renderRunner: fakeRender,
    });
    await slowServer.start();
    try {
      const res = await fetch(`${slowServer.url}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_RUN),
      });
      const { id } = (await res.json()) as { id: string };
      const renderRes = await fetch(`${slowServer.url}/api/runs/${id}/render`, { method: "POST" });
      expect(renderRes.status).toBe(409);
    } finally {
      await slowServer.stop();
    }
  });

  it("streams progress over SSE including replayed history", async () => {
    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_RUN),
    });
    const { id } = (await res.json()) as { id: string };
    await waitForStatus(base, id, "explored");

    // Connect late — history must be replayed.
    const controller = new AbortController();
    const sse = await fetch(`${base}/api/runs/${id}/events`, { signal: controller.signal });
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const reader = sse.body!.getReader();
    let text = "";
    while (!text.includes('"status":"explored"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    controller.abort();
    expect(text).toContain("turn 1: goto");
    expect(text).toContain('"type":"script"');
  });

  it("404s unknown runs and blocks path traversal", async () => {
    const missing = await fetch(`${base}/api/runs/nope`);
    expect(missing.status).toBe(404);

    const res = await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_RUN),
    });
    const { id } = (await res.json()) as { id: string };
    await waitForStatus(base, id, "explored");
    const traversal = await fetch(`${base}/artifacts/${id}/..%2F..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.status).toBe(404);
  });

  it("lists runs with their goal summary", async () => {
    await fetch(`${base}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_RUN),
    });
    const res = await fetch(`${base}/api/runs`);
    const body = (await res.json()) as { runs: Array<{ goal: string; status: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]!.goal).toContain("dashboard overview");
  });
});
