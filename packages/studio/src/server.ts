/**
 * DemoForge Studio — HTTP server.
 *
 * Routes:
 *   GET  /                      → the Studio single-page UI
 *   GET  /api/runs              → list runs (id, status, goal)
 *   POST /api/runs              → start an exploration run from user objectives
 *   GET  /api/runs/:id          → run detail (status, script, artifacts)
 *   POST /api/runs/:id/render   → render the explored script to video
 *   GET  /api/runs/:id/events   → SSE stream of run progress
 *   GET  /artifacts/:id/<path>  → static artifact files (video, screenshots)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join, normalize, extname } from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";
import { RunManager, type Run, type RunRequest } from "./runs.js";
import {
  realExploreRunner,
  realRenderRunner,
  saveScript,
  type ExploreRunner,
  type RenderRunner,
} from "./runners.js";
import { STUDIO_HTML } from "./ui.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".gif": "image/gif",
};

const DEFAULT_DENYLIST = [
  "delete",
  "remove",
  "dismiss",
  "sign out",
  "log out",
];

export interface StudioServerOptions {
  port?: number;
  host?: string;
  /** Root directory for run artifacts. Default: <cwd>/demoforge-output/studio */
  outputRoot?: string;
  /** Injectable for tests. */
  exploreRunner?: ExploreRunner;
  /** Injectable for tests. */
  renderRunner?: RenderRunner;
  /** Default LLM endpoint shown in the UI. */
  defaultLlmUrl?: string;
  /** Default model name shown in the UI. Blank means use the LLM server default. */
  defaultModel?: string;
}

export class StudioServer {
  private server: Server | null = null;
  private manager = new RunManager();
  private options: Required<Omit<StudioServerOptions, "exploreRunner" | "renderRunner">> & {
    exploreRunner: ExploreRunner;
    renderRunner: RenderRunner;
  };

  constructor(options: StudioServerOptions = {}) {
    this.options = {
      port: options.port ?? 4477,
      host: options.host ?? "127.0.0.1",
      outputRoot: options.outputRoot ?? join(process.cwd(), "demoforge-output", "studio"),
      exploreRunner: options.exploreRunner ?? realExploreRunner,
      renderRunner: options.renderRunner ?? realRenderRunner,
      defaultLlmUrl: options.defaultLlmUrl ?? "http://127.0.0.1:8080",
      defaultModel: options.defaultModel ?? "",
    };
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : this.options.port;
  }

  get url(): string {
    return `http://${this.options.host}:${this.port}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.route(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.options.port, this.options.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": MIME[".html"]! });
      res.end(
        STUDIO_HTML.replace("__DEFAULT_LLM_URL__", this.options.defaultLlmUrl).replace(
          "__DEFAULT_MODEL__",
          this.options.defaultModel,
        ),
      );
      return;
    }

    if (req.method === "GET" && path === "/api/runs") {
      this.json(res, 200, {
        runs: this.manager.list().map((run) => ({
          id: run.id,
          status: run.status,
          goal: run.request.goal.slice(0, 120),
          url: run.request.url,
          startedAt: run.startedAt,
        })),
      });
      return;
    }

    if (req.method === "POST" && path === "/api/runs") {
      const body = await this.readJson(req);
      const request = this.parseRunRequest(body);
      if (typeof request === "string") {
        this.json(res, 400, { error: request });
        return;
      }
      const run = this.manager.create(request, "");
      run.outputDir = join(this.options.outputRoot, run.id);
      this.startExploration(run);
      this.json(res, 202, { id: run.id });
      return;
    }

    const runMatch = path.match(/^\/api\/runs\/([a-z0-9-]+)(\/(events|render))?$/);
    if (runMatch) {
      const run = this.manager.get(runMatch[1]!);
      if (!run) {
        this.json(res, 404, { error: `No such run: ${runMatch[1]}` });
        return;
      }

      if (req.method === "GET" && runMatch[3] === "events") {
        this.streamEvents(req, res, run);
        return;
      }

      if (req.method === "POST" && runMatch[3] === "render") {
        if (!run.script || run.status === "exploring") {
          this.json(res, 409, { error: `Run ${run.id} has no script yet (status: ${run.status})` });
          return;
        }
        if (run.status === "rendering") {
          this.json(res, 409, { error: `Run ${run.id} is already rendering` });
          return;
        }
        this.startRender(run);
        this.json(res, 202, { id: run.id });
        return;
      }

      if (req.method === "GET" && !runMatch[2]) {
        this.json(res, 200, {
          id: run.id,
          status: run.status,
          request: run.request,
          script: run.script,
          artifacts: run.artifacts.map((a) => ({
            kind: a.kind,
            href: this.artifactHref(run, a.path),
          })),
        });
        return;
      }
    }

    const artifactMatch = path.match(/^\/artifacts\/([a-z0-9-]+)\/(.+)$/);
    if (req.method === "GET" && artifactMatch) {
      const run = this.manager.get(artifactMatch[1]!);
      if (!run) {
        this.json(res, 404, { error: "No such run" });
        return;
      }
      const rel = normalize(decodeURIComponent(artifactMatch[2]!)).replace(/^(\.\.[/\\])+/, "");
      const filePath = join(run.outputDir, rel);
      if (!filePath.startsWith(run.outputDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        this.json(res, 404, { error: "Artifact not found" });
        return;
      }
      const ext = extname(filePath);
      const headers: Record<string, string | number> = {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Length": statSync(filePath).size,
        "X-Content-Type-Options": "nosniff",
      };
      if (ext === ".mp4" || ext === ".webm") {
        const filename = basename(filePath).replace(/"/g, "");
        headers["Content-Disposition"] = `attachment; filename="${filename}"`;
      }
      res.writeHead(200, headers);
      createReadStream(filePath).pipe(res);
      return;
    }

    this.json(res, 404, { error: `Not found: ${req.method} ${path}` });
  }

  private startExploration(run: Run): void {
    this.manager.emit(run, {
      type: "status",
      status: "exploring",
      message: `Exploring ${run.request.url} with ${run.request.model ?? "server default model"}...`,
    });

    this.options
      .exploreRunner(run.request, run.outputDir, (message) =>
        this.manager.emit(run, { type: "log", message }),
      )
      .then((outcome) => {
        this.manager.emit(run, { type: "script", script: outcome.script });
        saveScript(run, this.manager);
        if (outcome.videoPath) {
          this.manager.emit(run, {
            type: "artifact",
            artifact: { kind: "video", path: outcome.videoPath },
          });
        }
        this.manager.emit(run, {
          type: "status",
          status: "explored",
          message: `Exploration ${outcome.success ? "complete" : `stopped (${outcome.stopReason})`} — ${outcome.script.steps?.length ?? 0} steps assembled${outcome.videoPath ? ", first-run video captured" : ""}. Ready to render.`,
        });
      })
      .catch((err) => {
        this.manager.emit(run, {
          type: "error",
          status: "failed",
          message: `Exploration failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  private startRender(run: Run): void {
    this.manager.emit(run, {
      type: "status",
      status: "rendering",
      message: "Replaying script with bounded video recording...",
    });

    this.options
      .renderRunner(run.script!, run.outputDir, (message) =>
        this.manager.emit(run, { type: "log", message }),
      )
      .then((outcome) => {
        if (outcome.videoPath) {
          this.manager.emit(run, {
            type: "artifact",
            artifact: { kind: "video", path: outcome.videoPath },
          });
        }
        for (const screenshot of outcome.screenshots) {
          this.manager.emit(run, {
            type: "artifact",
            artifact: { kind: "screenshot", path: screenshot },
          });
        }
        this.manager.emit(run, {
          type: "status",
          status: "rendered",
          message: `Render ${outcome.status} — ${outcome.screenshots.length} screenshot(s)${outcome.videoPath ? ", 1 video" : ""}.`,
        });
      })
      .catch((err) => {
        this.manager.emit(run, {
          type: "error",
          status: "failed",
          message: `Render failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }

  private streamEvents(req: IncomingMessage, res: ServerResponse, run: Run): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const unsubscribe = this.manager.subscribe(run, (event) => {
      const payload =
        event.type === "artifact" && event.artifact
          ? { ...event, artifact: { kind: event.artifact.kind, href: this.artifactHref(run, event.artifact.path) } }
          : event;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    });
    req.on("close", unsubscribe);
  }

  private artifactHref(run: Run, absolutePath: string): string {
    const rel = absolutePath.startsWith(run.outputDir)
      ? absolutePath.slice(run.outputDir.length).replace(/^[/\\]+/, "")
      : absolutePath;
    return `/artifacts/${run.id}/${rel.split("\\").join("/")}`;
  }

  private parseRunRequest(body: unknown): RunRequest | string {
    if (!body || typeof body !== "object") return "Request body must be a JSON object";
    const b = body as Record<string, unknown>;
    if (typeof b.url !== "string" || !/^https?:\/\//.test(b.url)) {
      return "url must be an http(s) URL";
    }
    if (typeof b.goal !== "string" || b.goal.trim().length < 10) {
      return "goal must describe your objectives (at least 10 characters)";
    }
    const denylist = Array.isArray(b.denylist)
      ? b.denylist.filter((d): d is string => typeof d === "string" && d.trim() !== "")
      : DEFAULT_DENYLIST;
    return {
      url: b.url,
      goal: b.goal.trim(),
      llmUrl: typeof b.llmUrl === "string" && b.llmUrl ? b.llmUrl : this.options.defaultLlmUrl,
      model:
        typeof b.model === "string" && b.model.trim()
          ? b.model.trim()
          : undefined,
      maxSteps:
        typeof b.maxSteps === "number" && b.maxSteps >= 3 && b.maxSteps <= 100
          ? Math.floor(b.maxSteps)
          : 25,
      denylist,
      viewport: { width: 1280, height: 720 },
    };
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1_000_000) {
          reject(new Error("Request body too large"));
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }
}
