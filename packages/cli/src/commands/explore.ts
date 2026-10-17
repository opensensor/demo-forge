/**
 * DemoForge CLI — explore command.
 *
 * Uses the LLM-powered explorer agent to discover a demo flow from a URL,
 * writes it as a reviewable demo script, and optionally renders it.
 * Usage: demoforge explore [url] --goal "..." [--base _base.yaml] [--render]
 *
 * With --base, the explorer starts from a shared script fragment: its setup
 * steps (login) run first so the agent explores a signed-in app, its
 * redaction rules apply, and the generated script `extends` it.
 */

import { Command } from "commander";
import {
  type Config,
  type DemoScript,
  type NarrationMode,
  createExplorerLlmAdapter,
  createLogger,
  ExplorerAgent,
  LlmClient,
  loadDemoScript,
  loadScriptFragment,
} from "@demoforge/core";
import { BrowserSession } from "@demoforge/browser";
import { Renderer, redactionScript, renderDemo, type TtsBackendName } from "@demoforge/renderer";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import yaml from "js-yaml";

/** Button texts the agent must never click on a live system. */
const DEFAULT_DENYLIST = [
  "delete",
  "remove",
  "restart",
  "shutdown",
  "reboot",
  "logout",
  "log out",
  "sign out",
  "force free space",
  "run cleanup",
  "reset",
  "factory",
  "format",
  "update stream",
  "save settings",
  "save",
];

interface ExploreOptions {
  goal: string;
  base?: string;
  name?: string;
  title?: string;
  output: string;
  llmUrl?: string;
  model?: string;
  maxSteps: string;
  deny?: string;
  render?: boolean;
  renderOutput: string;
  narration?: string;
  tts: string;
}

/** First model id advertised by an OpenAI-compatible server. */
async function discoverModel(llmUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${llmUrl.replace(/\/$/, "")}/v1/models`);
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return body.data?.[0]?.id;
  } catch {
    return undefined;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "explored";
}

/**
 * Swap literal values that came from env references in the base (e.g. the
 * app URL) back to `${env:NAME}` so generated scripts stay host-agnostic.
 */
export function reintroduceEnvRefs<T>(value: T, rawBase: Partial<DemoScript>, env: NodeJS.ProcessEnv): T {
  const refs = new Map<string, string>();
  const collect = (node: unknown) => {
    if (typeof node === "string") {
      for (const m of node.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        const name = m[1] as string;
        const v = env[name];
        // Only substitute distinctive values (never short ones like "demo").
        if (v && v.length >= 8 && /^https?:\/\//.test(v)) refs.set(v, `\${env:${name}}`);
      }
    } else if (Array.isArray(node)) {
      node.forEach(collect);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(collect);
    }
  };
  collect(rawBase);
  if (refs.size === 0) return value;
  let text = JSON.stringify(value);
  for (const [literal, ref] of refs) {
    text = text.split(literal.replace(/\/$/, "")).join(ref);
  }
  return JSON.parse(text) as T;
}

export function createExploreCommand(
  logger: ReturnType<typeof createLogger>,
  config: Config,
): Command {
  return new Command("explore")
    .description("Explore a web application with the local LLM agent and generate a demo script")
    .argument("[url]", "Start URL (default: the base script's url)")
    .requiredOption("--goal <goal>", "What the demo should show; the agent plans and narrates toward it")
    .option("--base <script>", "Shared script fragment for login setup, redaction, viewport, voice")
    .option("--name <name>", "Demo name / output filename (default: derived from the goal)")
    .option("--title <title>", "Demo title")
    .option("-o, --output <dir>", "Directory for the generated script", ".demoforge")
    .option("--llm-url <url>", "OpenAI-compatible LLM server (default: config llm.base_url)")
    .option("--model <model>", "Model id (default: first model the server advertises)")
    .option("--max-steps <n>", "Maximum agent turns", "25")
    .option("--deny <list>", "Extra comma-separated button texts the agent must not click")
    .option("--render", "Render the generated script right away")
    .option("--render-output <dir>", "Output root for --render", "demoforge-output")
    .option("--narration <mode>", "Narration mode for the generated script: none | captions | tts")
    .option("--tts <backend>", "TTS backend when rendering with narration tts", "kokoro")
    .action(async (urlArg: string | undefined, options: ExploreOptions) => {
      const base = options.base ? loadScriptFragment(options.base) : undefined;
      const baseScript = base?.resolved ?? {};
      const url = urlArg ?? baseScript.url;
      if (!url) {
        logger.error("No start URL: pass one or use --base with a script that sets `url`.");
        process.exit(1);
      }

      const llmUrl = options.llmUrl ?? config.llm?.base_url ?? "http://127.0.0.1:8080";
      const model = options.model ?? (await discoverModel(llmUrl)) ?? config.llm?.model ?? "local";
      const viewport = baseScript.viewport ?? { width: 1280, height: 720, scale: 1 as const };
      const name = options.name ?? slugify(options.goal);
      const title = options.title ?? name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      const narrationMode = (options.narration ?? baseScript.narration_mode ?? "captions") as NarrationMode;

      // ── Signed-in session from the base's setup steps ────────────────────
      let storageState;
      if (baseScript.setup?.length) {
        logger.info(`Running ${baseScript.setup.length} setup step(s) from ${options.base} ...`);
        const setupRenderer = new Renderer(
          { demo: "setup", title: "setup", viewport, narration_mode: "none", steps: [], setup: baseScript.setup },
          { stepTimeout: 20000 },
        );
        storageState = await setupRenderer.runSetup();
      }

      const browser = new BrowserSession({
        headless: true,
        headed: false,
        forbidHostDisplay: true,
        viewport: { width: viewport.width, height: viewport.height },
        timeout: 10000,
        initScripts: baseScript.redact?.length ? [redactionScript(baseScript.redact)] : [],
      });
      browser.configureContext({ storageState });

      const denylist = [
        ...DEFAULT_DENYLIST,
        ...(options.deny ? options.deny.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : []),
      ];
      const origin = new URL(url).origin;

      logger.info(`Exploring ${url} with ${model} @ ${llmUrl}`);
      logger.info(`Goal: ${options.goal}`);

      const agent = new ExplorerAgent({
        url,
        goal:
          `${options.goal}\n\n` +
          "Narrate what the viewer is seeing with short, friendly sentences (one idea each). " +
          "Describe features, not today's data: avoid exact counts, clock times, or dates that change. " +
          "This is a live production system: never change, save, or delete anything.",
        maxSteps: parseInt(options.maxSteps, 10),
        maxTime: 15 * 60 * 1000,
        viewport: { width: viewport.width, height: viewport.height, scale: 1 },
        guardrails: {
          allowedOrigins: [origin],
          destructiveButtonPatterns: denylist,
          destructiveUrlPatterns: ["/logout", "/api/auth/logout"],
        },
        reporter: {
          report(event) {
            if (event.type === "turn_start") logger.info(`  turn ${event.turn} …`);
            else if (event.message) logger.info(`  ${event.type}: ${event.message}`);
          },
        },
        llmClient: createExplorerLlmAdapter(
          new LlmClient({ baseURL: llmUrl, model, timeout: 300000, maxRetries: 2 }),
          { temperature: 0.2, maxTokens: 8192 },
        ),
        scriptTemplate: { title, narration_mode: narrationMode },
        requireConfirmation: false,
        browser,
      });

      const exploration = await agent.run();
      await browser.close().catch(() => {});

      const steps = exploration.script.steps ?? [];
      logger.info(
        `Exploration ${exploration.success ? "finished" : "stopped"} (${exploration.stopReason}); ` +
          `${exploration.transcript.totalTurns} turns, ${exploration.transcript.blockedTurns} blocked, ${steps.length} steps`,
      );
      if (steps.length === 0) {
        logger.error("The agent produced no steps — nothing to write.");
        process.exit(1);
      }

      // ── Write a reviewable script that extends the base ──────────────────
      const outDir = resolve(options.output);
      mkdirSync(outDir, { recursive: true });
      const scriptPath = join(outDir, `${name}.yaml`);
      const generated: Record<string, unknown> = {
        ...(options.base ? { extends: relative(dirname(scriptPath), resolve(options.base)) } : {}),
        demo: name,
        title,
        ...(options.base ? {} : { viewport }),
        narration_mode: narrationMode,
        steps: base ? reintroduceEnvRefs(steps, base.raw, process.env) : steps,
      };
      writeFileSync(
        scriptPath,
        `# Generated by \`demoforge explore\` (${model}).\n# Goal: ${options.goal}\n# Review before committing.\n` +
          yaml.dump(generated, { lineWidth: 100, noRefs: true }),
      );
      writeFileSync(join(outDir, `${name}.transcript.json`), JSON.stringify(exploration.transcript, null, 2));
      logger.info(`Script: ${scriptPath}`);

      if (!options.render) return;

      const script = loadDemoScript(scriptPath);
      const outputDir = resolve(options.renderOutput, script.demo);
      logger.info(`Rendering → ${outputDir}`);
      const result = await renderDemo(script, {
        outputDir,
        ttsBackend: options.tts as TtsBackendName,
        onLog: (m) => logger.debug(m),
      });
      if (result.render.status !== "success") {
        const bad = result.render.steps.find((s) => s.status === "failure" || s.status === "timeout");
        logger.error(`Render ${result.render.status} at step ${bad?.stepIndex} (${bad?.stepType})${bad && "error" in bad ? `: ${bad.error}` : ""}`);
        process.exit(1);
      }
      for (const [format, path] of Object.entries(result.produced?.outputs ?? {})) {
        logger.info(`  ${format}: ${path}`);
      }
    });
}
