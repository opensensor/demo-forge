/**
 * AI-driven dogfood demo: the ExplorerAgent uses a local LLM to discover and
 * walk through triaging an unresolved detection in the devops-agent SPA,
 * then the assembled script is replayed on video.
 *
 * Guardrails make this read-only: all mutating buttons (Block IP, Dismiss,
 * Add to Allowlist, Remove, ...) are on the destructive denylist because
 * enforcement is live on the target instance.
 *
 * Usage: node examples/devops-agent-explore.mjs [appUrl] [llmUrl] [model]
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  LlmClient,
  createExplorerLlmAdapter,
  ExplorerAgent,
} from "@demoforge/core";
import { BrowserSession } from "@demoforge/browser";
import { Renderer, CapturePipeline } from "@demoforge/renderer";

const appUrl = process.argv[2] ?? "http://127.0.0.1:8081";
const llmUrl = process.argv[3] ?? "http://127.0.0.1:8080";
const model = process.argv[4] ?? "local-heavy";
const outputDir = join(process.cwd(), "demoforge-output", "devops-agent-ai");
mkdirSync(join(outputDir, "videos"), { recursive: true });

// ─── Phase 1: LLM-driven exploration ────────────────────────────────────────

const httpClient = new LlmClient({
  baseURL: llmUrl,
  model,
  timeout: 300000,
  maxRetries: 2,
});

const explorationBrowser = new BrowserSession({
  headless: true,
  headed: false,
  forbidHostDisplay: true,
  viewport: { width: 1280, height: 720 },
  timeout: 8000,
});

const agent = new ExplorerAgent({
  url: appUrl,
  goal:
    "Demonstrate how an on-call engineer triages one unresolved (Detected) incident. " +
    "Start on the Incidents view, filter to Detected incidents, pick the first incident, " +
    "and review its evidence: the auth-failure count, status codes, targeted hosts, and " +
    "top requested paths. Use the WHOIS and Recommendation buttons of that incident to " +
    "gather context (these are read-only lookups). Add narration explaining what the " +
    "engineer is looking at and why. Do NOT click Block IP, Block + Report, Dismiss, " +
    "Report Abuse, Add to Allowlist, or Remove — those mutate production state.",
  maxSteps: 25,
  maxTime: 600000,
  viewport: { width: 1280, height: 720, scale: 1 },
  guardrails: {
    allowedOrigins: [appUrl],
    destructiveButtonPatterns: [
      "block ip",
      "block + report",
      "block and report",
      "dismiss",
      "report abuse",
      "add to allowlist",
      "remove",
      "delete",
      "apply",
      "approve",
    ],
    destructiveUrlPatterns: ["/api/blocks", "/api/allowlist"],
    maxSteps: 25,
    maxTime: 600000,
  },
  reporter: {
    report(event) {
      const bits = [event.type, event.turn ?? "", event.message ?? ""].filter(Boolean);
      console.log(`  [explore] ${bits.join(" | ")}`);
    },
  },
  llmClient: createExplorerLlmAdapter(httpClient, { temperature: 0.2, maxTokens: 8192 }),
  scriptTemplate: {
    title: "Triaging a Detected Incident — DevOps Network Monitoring Agent",
    narration_mode: "captions",
  },
  requireConfirmation: false,
  browser: explorationBrowser,
});

console.log(`Exploring ${appUrl} with ${model} @ ${llmUrl} ...`);
const exploration = await agent.run();
await explorationBrowser.close().catch(() => {});

console.log(`\nExploration: success=${exploration.success} stop=${exploration.stopReason}`);
console.log(
  `Turns: ${exploration.transcript.totalTurns} (blocked: ${exploration.transcript.blockedTurns})`,
);

const scriptPath = join(outputDir, "explored-script.json");
writeFileSync(scriptPath, JSON.stringify(exploration.script, null, 2));
console.log(`Assembled script (${exploration.script.steps?.length ?? 0} steps): ${scriptPath}`);

if (!exploration.script.steps?.length) {
  console.error("Exploration produced no steps — see transcript above.");
  process.exit(1);
}

// ─── Phase 2: deterministic replay with video + screenshots ────────────────

console.log("\nReplaying explored script on video ...");
const renderBrowser = new BrowserSession({
  headless: true,
  headed: false,
  forbidHostDisplay: true,
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: join(outputDir, "videos"), size: { width: 1280, height: 720 } },
});

const renderer = new Renderer(
  exploration.script,
  { outputDir, stepTimeout: 20000, globalTimeout: 180000 },
  renderBrowser,
);
const result = await renderer.render();
await renderBrowser.close().catch(() => {});

console.log(`Render status: ${result.status}`);
for (const s of result.steps) {
  const err = "error" in s && s.error ? ` — ${s.error}` : "";
  console.log(`  ${String(s.stepIndex).padStart(2)} ${s.stepType.padEnd(12)} ${s.status}${err}`);
}

if (renderBrowser.videoPath && existsSync(renderBrowser.videoPath)) {
  const rawWebm = join(outputDir, "videos", "triage-walkthrough.webm");
  copyFileSync(renderBrowser.videoPath, rawWebm);
  const pipeline = new CapturePipeline();
  const encoded = await pipeline.encode(rawWebm, {
    format: "mp4",
    width: 1280,
    height: 720,
    fps: 24,
    quality: "small",
    threads: 2,
    outputPath: join(outputDir, "videos", "triage-walkthrough.mp4"),
  });
  console.log(
    encoded.success
      ? `\nVideo: ${encoded.metadata.outputPath}`
      : `\nEncode failed: ${encoded.error}`,
  );
}
