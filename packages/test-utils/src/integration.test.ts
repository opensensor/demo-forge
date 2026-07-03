/**
 * Integration tests for the mock LLM server with test utilities.
 *
 * Verifies that withMockLlm() properly wraps tests and that
 * demo script fixtures validate correctly.
 */

import { describe, it, expect } from "vitest";
import { withMockLlm, expectValidScript, loadScriptFixture } from "@demoforge/test-utils";
import type { MockLlmRequest } from "@demoforge/test-utils/mock-llm-server";

describe("Mock LLM integration", () => {
  it("simulates an LLM call for a login flow", withMockLlm(async (server) => {
    const request: MockLlmRequest = {
      model: "mock-model",
      messages: [
        { role: "system", content: "You are a demo script generator." },
        { role: "user", content: "Generate a click action for the login button." },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "action",
          schema: {
            type: "object",
            properties: {
              action: { type: "string" },
              selector: { type: "object" },
            },
            required: ["action", "selector"],
          },
        },
      },
    };

    const res = await fetch(server.apiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.choices[0].message.role).toBe("assistant");

    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toHaveProperty("action");
  }));

  it("simulates an LLM call for a dashboard flow", withMockLlm(async (server) => {
    const request: MockLlmRequest = {
      model: "mock-model",
      messages: [
        { role: "user", content: "Generate a goto action for the dashboard." },
      ],
    };

    const res = await fetch(server.apiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.usage.total_tokens).toBeGreaterThan(0);
  }));

  it("validates login-flow fixture", () => {
    const fixture = loadScriptFixture("demoscripts/login-flow.json");
    expectValidScript(fixture.content);
  });

  it("validates dashboard-walkthrough fixture", () => {
    const fixture = loadScriptFixture("demoscripts/dashboard-walkthrough.json");
    expectValidScript(fixture.content);
  });

  it("validates form-submission fixture", () => {
    const fixture = loadScriptFixture("demoscripts/form-submission.json");
    expectValidScript(fixture.content);
  });

  it("validates multi-flow-demo fixture", () => {
    const fixture = loadScriptFixture("demoscripts/multi-flow-demo.json");
    expectValidScript(fixture.content);
  });

  it("rejects invalid-missing-name fixture", () => {
    const fixture = loadScriptFixture("demoscripts/invalid-missing-name.json");
    expect(() => expectValidScript(fixture.content)).toThrow();
  });

  it("rejects invalid-bad-action fixture", () => {
    const fixture = loadScriptFixture("demoscripts/invalid-bad-action.json");
    expect(() => expectValidScript(fixture.content)).toThrow();
  });
});
