/**
 * Dogfood demo: render a walkthrough of the devops-agent SPA.
 *
 * Read-only by design — it navigates, filters, and screenshots, but never
 * touches approve/reject/add buttons (enforcement is live on this instance).
 *
 * Usage: node examples/devops-agent-demo.mjs [baseUrl]
 * Outputs land in demoforge-output/devops-agent/.
 */

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession } from "@demoforge/browser";
import { Renderer, CapturePipeline } from "@demoforge/renderer";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8081";
const outputDir = join(process.cwd(), "demoforge-output", "devops-agent");
mkdirSync(join(outputDir, "videos"), { recursive: true });

const script = {
  demo: "devops-agent-walkthrough",
  title: "DevOps Network Monitoring Agent — Walkthrough",
  url: baseUrl,
  viewport: { width: 1280, height: 720, scale: 1 },
  narration_mode: "none",
  steps: [
    { goto: baseUrl },
    { wait_for: { text: "DevOps Network Monitoring Agent" } },
    { wait_for: { selector: { css: "#incidents-list .incident-item" } } },
    { narrate: "The agent detects auth-failure incidents from OpenSearch logs." },
    { pause: 1200 },
    { screenshot: { name: "01-incidents-overview" } },
    { select: { target: { css: "#incident-status-filter" }, value: "detected" } },
    { pause: 800 },
    { screenshot: { name: "02-filter-detected" } },
    { fill: { target: { css: "#incident-search" }, value: "auth" } },
    { pause: 800 },
    { screenshot: { name: "03-search-incidents" } },
    { click: { css: "#clear-incident-filters" } },
    { pause: 600 },
    { click: { role: "button", name: "Allowlist" } },
    { wait_for: { text: "Allowlist Management" } },
    { pause: 1200 },
    { screenshot: { name: "04-allowlist" } },
    { click: { role: "button", name: "Incidents" } },
    { pause: 800 },
    { done: true },
  ],
};

console.log(`Rendering demo against ${baseUrl} ...`);

const browser = new BrowserSession({
  headless: true,
  headed: false,
  forbidHostDisplay: true,
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: join(outputDir, "videos"), size: { width: 1280, height: 720 } },
});

const renderer = new Renderer(script, { outputDir, stepTimeout: 10000, globalTimeout: 60000 }, browser);

const result = await renderer.render();
await browser.close().catch(() => {});

console.log(`\nRender status: ${result.status}`);
for (const s of result.steps) {
  const err = "error" in s && s.error ? ` — ${s.error}` : "";
  console.log(`  ${String(s.stepIndex).padStart(2)} ${s.stepType.padEnd(12)} ${s.status}${err}`);
}

if (!browser.videoPath || !existsSync(browser.videoPath)) {
  console.error("\nNo video was recorded — aborting encode.");
  process.exit(1);
}

const rawWebm = join(outputDir, "videos", "devops-agent-walkthrough.webm");
copyFileSync(browser.videoPath, rawWebm);
console.log(`\nRaw recording: ${rawWebm}`);

const pipeline = new CapturePipeline();
for (const format of ["mp4", "gif"]) {
  const encoded = await pipeline.encode(rawWebm, {
    format,
    width: 1280,
    height: 720,
    fps: format === "gif" ? 10 : 24,
    quality: "small",
    threads: 2,
    outputPath: join(outputDir, "videos", `devops-agent-walkthrough.${format}`),
  });
  if (encoded.success) {
    console.log(`Encoded ${format}: ${encoded.metadata.outputPath} (${encoded.metadata.fileSize} bytes)`);
  } else {
    console.error(`Encode ${format} FAILED: ${encoded.error}`);
  }
}
