/**
 * DemoForge Studio — run lifecycle management.
 *
 * A "run" is one crafted demo: the user's objectives drive an LLM
 * exploration, which assembles a demo script, which can then be rendered
 * into video/screenshot artifacts. Progress events are buffered so an SSE
 * subscriber that connects late still sees the full history.
 */

import { randomUUID } from "node:crypto";
import type { DemoScript } from "@demoforge/core";

export type RunStatus =
  | "exploring"
  | "explored"
  | "rendering"
  | "rendered"
  | "failed";

export interface RunRequest {
  /** Target app URL to explore. */
  url: string;
  /** The user's objectives — what the demo should show and why. */
  goal: string;
  /** OpenAI-compatible LLM endpoint. */
  llmUrl: string;
  /** Model name. Omitted to let the LLM server use its loaded default. */
  model?: string;
  /** Max exploration steps. */
  maxSteps: number;
  /** Button-text patterns the agent must never click. */
  denylist: string[];
  /** Viewport dimensions. */
  viewport: { width: number; height: number };
}

export interface RunEvent {
  type: "status" | "log" | "script" | "artifact" | "error";
  /** Milliseconds since run start. */
  at: number;
  message?: string;
  status?: RunStatus;
  script?: DemoScript;
  artifact?: { kind: "video" | "screenshot" | "script"; path: string };
}

export interface Run {
  id: string;
  request: RunRequest;
  status: RunStatus;
  startedAt: number;
  outputDir: string;
  script?: DemoScript;
  events: RunEvent[];
  artifacts: Array<{ kind: "video" | "screenshot" | "script"; path: string }>;
  subscribers: Set<(event: RunEvent) => void>;
}

export class RunManager {
  private runs = new Map<string, Run>();

  create(request: RunRequest, outputDir: string): Run {
    const run: Run = {
      id: randomUUID().slice(0, 8),
      request,
      status: "exploring",
      startedAt: Date.now(),
      outputDir,
      events: [],
      artifacts: [],
      subscribers: new Set(),
    };
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  list(): Run[] {
    return Array.from(this.runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  emit(run: Run, event: Omit<RunEvent, "at">): void {
    const full: RunEvent = { ...event, at: Date.now() - run.startedAt };
    if (event.status) run.status = event.status;
    if (event.script) run.script = event.script;
    if (event.artifact) run.artifacts.push(event.artifact);
    run.events.push(full);
    for (const subscriber of run.subscribers) {
      subscriber(full);
    }
  }

  subscribe(run: Run, subscriber: (event: RunEvent) => void): () => void {
    // Replay history so late subscribers see the whole run.
    for (const event of run.events) {
      subscriber(event);
    }
    run.subscribers.add(subscriber);
    return () => run.subscribers.delete(subscriber);
  }
}
