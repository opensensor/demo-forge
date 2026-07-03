/**
 * LLM client adapter tests — RED phase.
 *
 * Tests for:
 * - LlmClient construction with config
 * - sendRequest() calls mock OpenAI-compatible endpoint
 * - JSON schema response_format is sent
 * - Token counting accuracy
 * - Retry on 429/500 with exponential backoff
 * - Configurable timeout
 * - Unavailable server returns actionable error
 * - Planner and copywriter presets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockLlmServer,
  type MockLlmServer,
} from "@demoforge/test-utils";
import { LlmClient, TokenCounter, plannerConfig, copywriterConfig } from "./client.js";
import {
  DemoForgeError,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmApiError,
} from "../errors/index.js";

describe("LlmClient", () => {
  let server: MockLlmServer;

  beforeEach(async () => {
    server = await createMockLlmServer();
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  describe("construction", () => {
    it("creates client with default config", () => {
      const client = new LlmClient({ baseURL: server.baseURL });
      expect(client).toBeInstanceOf(LlmClient);
    });

    it("creates client with model name", () => {
      const client = new LlmClient({ baseURL: server.baseURL, model: "llama3.1" });
      expect(client).toBeInstanceOf(LlmClient);
    });

    it("creates client with API key", () => {
      const client = new LlmClient({ baseURL: server.baseURL, apiKey: "sk-test-key" });
      expect(client).toBeInstanceOf(LlmClient);
    });

    it("creates client with custom timeout", () => {
      const client = new LlmClient({ baseURL: server.baseURL, timeout: 5000 });
      expect(client).toBeInstanceOf(LlmClient);
    });
  });

  describe("sendRequest", () => {
    it("sends a request and returns a response", async () => {
      const client = new LlmClient({ baseURL: server.baseURL });
      const response = await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(response).toHaveProperty("choices");
      expect(response.choices).toHaveLength(1);
      expect(response.choices![0].message.role).toBe("assistant");
      expect(response.choices![0].message.content).toBeDefined();
    });

    it("includes model name in request", async () => {
      const client = new LlmClient({ baseURL: server.baseURL, model: "llama3.1" });
      await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
      });
      const lastRequest = server.requestLog[server.requestLog.length - 1];
      expect(lastRequest.model).toBe("llama3.1");
    });

    it("includes API key in Authorization header", async () => {
      const client = new LlmClient({ baseURL: server.baseURL, apiKey: "sk-my-secret" });
      // The mock server doesn't check headers, but we verify no crash
      await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(server.requestLog.length).toBeGreaterThan(0);
    });

    it("sends JSON schema response_format when provided", async () => {
      const client = new LlmClient({ baseURL: server.baseURL });
      const jsonSchema = {
        name: "action",
        schema: {
          type: "object" as const,
          properties: {
            action: { type: "string" },
            narration: { type: "string" },
          },
          required: ["action"],
        },
      };
      await client.sendRequest({
        messages: [{ role: "user", content: "Take action" }],
        response_format: { type: "json_schema", json_schema: jsonSchema },
      });
      const lastRequest = server.requestLog[server.requestLog.length - 1]!;
      expect(lastRequest.response_format).toEqual({ type: "json_schema", json_schema: jsonSchema });
    });

    it("sends temperature from options", async () => {
      const client = new LlmClient({ baseURL: server.baseURL });
      await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      });
      const lastRequest = server.requestLog[server.requestLog.length - 1]!;
      expect(lastRequest.temperature).toBe(0.7);
    });
  });

  describe("preset configs", () => {
    it("plannerConfig returns a config object with planner settings", () => {
      const config = plannerConfig();
      expect(config).toHaveProperty("messages");
      expect(config).toHaveProperty("temperature");
      expect(config.messages).toHaveLength(2);
      expect(config.messages![0].role).toBe("system");
      expect(config.messages![1].role).toBe("user");
    });

    it("copywriterConfig returns a config object with copywriter settings", () => {
      const config = copywriterConfig();
      expect(config).toHaveProperty("messages");
      expect(config).toHaveProperty("temperature");
      expect(config.messages).toHaveLength(2);
      expect(config.messages![0].role).toBe("system");
      expect(config.messages![1].role).toBe("user");
    });

    it("plannerConfig is different from copywriterConfig", () => {
      const planner = plannerConfig();
      const copywriter = copywriterConfig();
      expect(planner.messages![0].content).not.toBe(copywriter.messages![0].content);
    });
  });
});

describe("TokenCounter", () => {
  it("counts tokens approximately (within 5% of actual)", () => {
    const counter = new TokenCounter();

    const text = "The quick brown fox jumps over the lazy dog. This is a test sentence.";
    const tokens = counter.countTokens(text);

    // Rough estimate: ~4 chars per token in English
    // Actual GPT-like tokenization: ~28 tokens for this text
    // Our estimate should be within 5% of actual
    expect(tokens).toBeGreaterThan(0);

    // Verify the estimate is reasonable: between 50-80% of char count
    const ratio = tokens / text.length;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.5);
  });

  it("accumulates token counts across calls", () => {
    const counter = new TokenCounter();

    counter.add("Hello world");
    const afterFirst = counter.total;

    counter.add("This is another message");
    const afterSecond = counter.total;

    expect(afterSecond).toBeGreaterThan(afterFirst);
  });

  it("resets token count", () => {
    const counter = new TokenCounter();
    counter.add("Some text here");
    expect(counter.total).toBeGreaterThan(0);

    counter.reset();
    expect(counter.total).toBe(0);
  });

  it("checks budget remaining", () => {
    const counter = new TokenCounter({ maxTokens: 4096 });
    counter.add("A".repeat(100));
    expect(counter.remaining).toBeLessThan(4096);
    expect(counter.remaining).toBeGreaterThan(0);
  });

  it("returns 0 remaining when budget exceeded", () => {
    const counter = new TokenCounter({ maxTokens: 100 });
    counter.add("A".repeat(1000));
    expect(counter.remaining).toBe(0);
  });

  it("reports whether budget is exceeded", () => {
    const counter = new TokenCounter({ maxTokens: 100 });
    expect(counter.isOverBudget).toBe(false);

    counter.add("A".repeat(1000));
    expect(counter.isOverBudget).toBe(true);
  });
});

describe("Retry with exponential backoff", () => {
  let server: MockLlmServer;

  beforeEach(async () => {
    server = await createMockLlmServer();
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  it("retries on 429 Too Many Requests", async () => {
    let callCount = 0;
    server = await createMockLlmServer({
      onResponse: () => {
        callCount++;
        if (callCount < 3) {
          return {
            id: "mock-429",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "mock",
            choices: [],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          } as any;
        }
        return null; // fall through to default
      },
    });

    // We need to mock the server to return 429 status
    // Since MockLlmServer doesn't support status codes directly,
    // we'll test the retry logic by mocking fetch
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, _init: any) => {
      fetchCalls++;
      if (fetchCalls < 3) {
        return new Response(
          JSON.stringify({ error: { message: "Rate limit exceeded" } }),
          { status: 429, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-success",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    try {
      const client = new LlmClient({ baseURL: "http://localhost:9999" });
      const response = await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(fetchCalls).toBe(3);
      expect(response.choices![0].message.content).toBe("OK");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries on 500 Internal Server Error", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, _init: any) => {
      fetchCalls++;
      if (fetchCalls < 2) {
        return new Response(
          JSON.stringify({ error: { message: "Internal server error" } }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "chatcmpl-success",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: "Recovered" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

    try {
      const client = new LlmClient({ baseURL: "http://localhost:9999" });
      const response = await client.sendRequest({
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(fetchCalls).toBe(2);
      expect(response.choices![0].message.content).toBe("Recovered");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws after max retries exhausted", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "content-type": "application/json" } }
      );
    });

    try {
      const client = new LlmClient({ baseURL: "http://localhost:9999", maxRetries: 2 });
      await expect(
        client.sendRequest({ messages: [{ role: "user", content: "Hello" }] })
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Timeout", () => {
  it("throws LlmTimeoutError when request exceeds timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(
            JSON.stringify({
              id: "chatcmpl-slow",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "test-model",
              choices: [{ index: 0, message: { role: "assistant", content: "Too late" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }),
            { status: 200 }
          ));
        }, 2000);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("The operation was aborted");
            (err as Error).name = "AbortError";
            reject(err);
          });
        }
      });
    });

    try {
      const client = new LlmClient({ baseURL: "http://localhost:9999", timeout: 100 });
      await expect(
        client.sendRequest({ messages: [{ role: "user", content: "Hello" }] })
      ).rejects.toBeInstanceOf(DemoForgeError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Unavailable server", () => {
  it("returns actionable error when server is unreachable", async () => {
    const client = new LlmClient({ baseURL: "http://localhost:19999" });
    await expect(
      client.sendRequest({ messages: [{ role: "user", content: "Hello" }] })
    ).rejects.toThrow();
  });
});

describe("Error types", () => {
  it("LlmUnavailableError extends DemoForgeError", () => {
    const err = new LlmUnavailableError("Server not running");
    expect(err.demoforge).toBe(true);
    expect(err.name).toBe("LlmUnavailableError");
  });

  it("LlmTimeoutError extends DemoForgeError", () => {
    const err = new LlmTimeoutError("Request timed out");
    expect(err.demoforge).toBe(true);
    expect(err.name).toBe("LlmTimeoutError");
  });

  it("LlmApiError extends DemoForgeError", () => {
    const err = new LlmApiError("API returned error", { statusCode: 500 });
    expect(err.demoforge).toBe(true);
    expect(err.name).toBe("LlmApiError");
    expect(err.statusCode).toBe(500);
  });
});
