/**
 * Mock LLM server that mimics the OpenAI-compatible API with JSON schema response_format.
 *
 * Usage:
 *   const server = await createMockLlmServer({ port: 18789 });
 *   // server.baseURL is ready to use as OPENAI_BASE_URL
 *   // ... run tests ...
 *   await server.close();
 */

import express from "express";
import type { Request, Response, RequestHandler } from "express";

export interface MockLlmRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  response_format?: { type: "json_schema"; json_schema?: Record<string, unknown> };
  temperature?: number;
  max_tokens?: number;
}

export interface MockLlmResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop" | "length";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  [key: string]: unknown;
}

export interface MockLlmServerOptions {
  /** Port to listen on. Defaults to a random available port. */
  port?: number;
  /** Base URL to bind to. Defaults to '127.0.0.1'. */
  host?: string;
  /** Predefined responses keyed by a simple key (e.g. "login_flow", "dashboard"). */
  predefinedResponses?: Record<string, string>;
  /** Custom response override — can inspect the full request and return a custom response. */
  onResponse?: (request: MockLlmRequest) => string | MockLlmResponse | null;
}

let nextRequestId = 1;

function generateId(): string {
  return `chatcmpl-mock-${nextRequestId++}`;
}

function buildDefaultResponse(request: MockLlmRequest, content: string): MockLlmResponse {
  const promptTokens = JSON.stringify(request).length;
  const completionTokens = content.length;
  return {
    id: generateId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.model || "mock-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export class MockLlmServer {
  private app: express.Application;
  private server: ReturnType<express.Application["listen"]> | null = null;
  private _port: number;
  private _host: string;
  private predefinedResponses: Record<string, string>;
  private onResponse?: (request: MockLlmRequest) => string | MockLlmResponse | null;
  private _requestLog: Array<MockLlmRequest> = [];

  constructor(options: MockLlmServerOptions = {}) {
    this._port = options.port ?? 0;
    this._host = options.host ?? "127.0.0.1";
    this.predefinedResponses = options.predefinedResponses ?? {};
    this.onResponse = options.onResponse;
    this.app = express();
    this.app.use(express.json({ limit: "10mb" }));
    this.setupRoutes();
  }

  get port(): number {
    return this._port;
  }

  get host(): string {
    return this._host;
  }

  get baseURL(): string {
    return `http://${this._host}:${this._port}`;
  }

  get apiURL(): string {
    return `${this.baseURL}/v1/chat/completions`;
  }

  get requestLog(): ReadonlyArray<MockLlmRequest> {
    return this._requestLog;
  }

  private setupRoutes(): void {
    const handler: RequestHandler = (req: Request, res: Response) => {
      this.handleCompletion(req, res);
    };

    // OpenAI-compatible endpoint
    this.app.post("/v1/chat/completions", handler);
    // Also support the root /chat/completions for flexibility
    this.app.post("/chat/completions", handler);
    // Model listing endpoint
    this.app.get("/v1/models", (_req, res) => {
      res.json({
        object: "list",
        data: [
          {
            id: "mock-model",
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "demoforge",
          },
        ],
      });
    });
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });
  }

  private handleCompletion(req: Request, res: Response): void {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({ error: { message: "Request body is required" }, type: "bad_request" });
      return;
    }

    const request: MockLlmRequest = {
      model: (body.model as string) || "mock-model",
      messages: (body.messages as Array<{ role: "system" | "user" | "assistant"; content: string }>) || [],
      response_format: (body.response_format as { type: "json_schema"; json_schema?: Record<string, unknown> })
        || undefined,
      temperature: (body.temperature as number) ?? 0,
      max_tokens: (body.max_tokens as number) ?? 4096,
    };

    this._requestLog.push(request);

    // Check for predefined response key in messages
    const fullMessage = request.messages.map((m) => m.content).join("\n");
    let content: string | null = null;

    for (const [key, value] of Object.entries(this.predefinedResponses)) {
      if (fullMessage.toLowerCase().includes(key.toLowerCase())) {
        content = value;
        break;
      }
    }

    // Check custom response override
    if (content === null && this.onResponse) {
      const custom = this.onResponse(request);
      if (custom !== null) {
        if (typeof custom === "string") {
          content = custom;
        } else {
          res.json(custom);
          return;
        }
      }
    }

    // Default response: echo back a valid JSON structure
    if (content === null) {
      content = JSON.stringify({
        action: "narrate",
        narration: "Demo step completed.",
        notes: "Mock LLM response.",
      });
    }

    const response = buildDefaultResponse(request, content);
    res.json(response);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this._port, this._host);
      server.once("error", (err: Error) => {
        this.server = null;
        reject(err);
      });
      server.once("listening", () => {
        this.server = server;
        const addr = server.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (server) {
      this.server = null;
      await new Promise<void>((resolve, reject) => {
        // Drop any keep-alive sockets so close() can complete promptly.
        server.closeAllConnections();
        server.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    this._requestLog = [];
  }
}

export async function createMockLlmServer(options: MockLlmServerOptions = {}): Promise<MockLlmServer> {
  const server = new MockLlmServer(options);
  await server.start();
  return server;
}
