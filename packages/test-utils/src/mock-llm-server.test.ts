/**
 * Tests for the mock LLM server.
 *
 * Verifies that the mock LLM server responds to OpenAI-compatible requests
 * with valid JSON schema responses.
 */

import { describe, it, expect } from "vitest";
import { createMockLlmServer, type MockLlmRequest } from "./mock-llm-server.js";

describe("MockLlmServer", () => {
  it("starts and responds to health check", async () => {
    const server = await createMockLlmServer();
    try {
      const res = await fetch(`${server.baseURL}/health`);
      expect(res.status).toBe(200);
      expect((await res.json()) as any).toEqual({ status: "ok" });
    } finally {
      await server.close();
    }
  });

  it("responds to /v1/chat/completions with valid OpenAI-compatible format", async () => {
    const server = await createMockLlmServer();
    try {
      const request: MockLlmRequest = {
        model: "mock-model",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello." },
        ],
        response_format: { type: "json_schema" },
        temperature: 0,
      };

      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;

      expect(body.id).toBeDefined();
      expect(body.id).toMatch(/^chatcmpl-mock-/);
      expect(body.object).toBe("chat.completion");
      expect(body.created).toBeDefined();
      expect(typeof body.created).toBe("number");
      expect(body.model).toBe("mock-model");
      expect(body.choices).toHaveLength(1);
      expect(body.choices[0].index).toBe(0);
      expect(body.choices[0].message.role).toBe("assistant");
      expect(body.choices[0].message.content).toBeDefined();
      expect(body.choices[0].finish_reason).toBe("stop");
      expect(body.usage).toBeDefined();
      expect(body.usage.prompt_tokens).toBeGreaterThan(0);
      expect(body.usage.completion_tokens).toBeGreaterThan(0);
      expect(body.usage.total_tokens).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("returns JSON content from response body", async () => {
    const server = await createMockLlmServer();
    try {
      const request: MockLlmRequest = {
        model: "mock-model",
        messages: [
          { role: "user", content: "Generate a login flow step." },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "login_action",
            schema: {
              type: "object",
              properties: {
                action: { type: "string" },
                narration: { type: "string" },
              },
              required: ["action", "narration"],
            },
          },
        },
      };

      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const body = (await res.json()) as any;
      const content = JSON.parse(body.choices[0].message.content);
      expect(content.action).toBe("narrate");
      expect(typeof content.narration).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("supports predefined responses", async () => {
    const server = await createMockLlmServer({
      predefinedResponses: {
        login: JSON.stringify({ action: "click", selector: { role: "button", name: "Sign In" } }),
      },
    });
    try {
      const request: MockLlmRequest = {
        model: "mock-model",
        messages: [
          { role: "user", content: "Generate a login flow for the login page." },
        ],
      };

      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const body = (await res.json()) as any;
      const content = JSON.parse(body.choices[0].message.content);
      expect(content.action).toBe("click");
    } finally {
      await server.close();
    }
  });

  it("supports custom onResponse handler", async () => {
    const expectedContent = JSON.stringify({ action: "goto", url: "/dashboard" });
    const server = await createMockLlmServer({
      onResponse: () => expectedContent,
    });
    try {
      const request: MockLlmRequest = {
        model: "mock-model",
        messages: [{ role: "user", content: "anything" }],
      };

      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const body = (await res.json()) as any;
      expect(body.choices[0].message.content).toBe(expectedContent);
    } finally {
      await server.close();
    }
  });

  it("logs all requests in requestLog", async () => {
    const server = await createMockLlmServer();
    try {
      await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "test" }],
        }),
      });

      expect(server.requestLog).toHaveLength(1);
      expect(server.requestLog[0]!.model).toBe("test-model");
    } finally {
      await server.close();
    }
  });

  it("supports /chat/completions endpoint as fallback", async () => {
    const server = await createMockLlmServer();
    try {
      const res = await fetch(`${server.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          messages: [{ role: "user", content: "test" }],
        }),
      });

      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("returns model listing at /v1/models", async () => {
    const server = await createMockLlmServer();
    try {
      const res = await fetch(`${server.baseURL}/v1/models`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.object).toBe("list");
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("mock-model");
    } finally {
      await server.close();
    }
  });

  it("handles empty request body gracefully", async () => {
    const server = await createMockLlmServer();
    try {
      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });

      expect([200, 400]).toContain(res.status);
    } finally {
      await server.close();
    }
  });

  it("closes cleanly and clears request log", async () => {
    const server = await createMockLlmServer();
    await fetch(server.apiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test",
        messages: [{ role: "user", content: "test" }],
      }),
    });

    expect(server.requestLog).toHaveLength(1);

    await server.close();
    expect(server.requestLog).toHaveLength(0);
  });
});
