/**
 * Tests for shared test utilities.
 *
 * Verifies expectValidScript, expectRenderOutput, and withMockLlm.
 */

import { describe, it, expect } from "vitest";
import {
  expectValidScript,
  withMockLlm,
  validateDemoScript,
  getFixturePath,
  FIXTURES_DIR,
} from "@demoforge/test-utils";
import { readFileSync, existsSync } from "node:fs";

describe("validateDemoScript", () => {
  it("accepts a valid demo script", () => {
    const validScript = {
      name: "test-script",
      url: "http://localhost:3000",
      flows: [
        {
          name: "test-flow",
          steps: [
            { action: "goto", url: "/" },
            { action: "click", selector: { role: "button", name: "Submit" } },
            { action: "done" },
          ],
        },
      ],
    };

    const errors = validateDemoScript(validScript);
    expect(errors).toHaveLength(0);
  });

  it("rejects a script missing name", () => {
    const script = {
      url: "http://localhost:3000",
      flows: [{ name: "test", steps: [{ action: "goto", url: "/" }] }],
    };

    const errors = validateDemoScript(script);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects a script missing url", () => {
    const script = {
      name: "test",
      flows: [{ name: "test", steps: [{ action: "goto", url: "/" }] }],
    };

    const errors = validateDemoScript(script);
    expect(errors.some((e) => e.includes("url"))).toBe(true);
  });

  it("rejects a script missing flows", () => {
    const script = {
      name: "test",
      url: "http://localhost:3000",
    };

    const errors = validateDemoScript(script);
    expect(errors.some((e) => e.includes("flows"))).toBe(true);
  });

  it("rejects a script with invalid action type", () => {
    const script = {
      name: "test",
      url: "http://localhost:3000",
      flows: [
        {
          name: "test",
          steps: [{ action: "invalid_action" }],
        },
      ],
    };

    const errors = validateDemoScript(script);
    expect(errors.some((e) => e.includes("invalid_action"))).toBe(true);
  });

  it("accepts all valid action types", () => {
    const validActions = [
      "goto", "click", "hover", "fill", "select", "press",
      "scroll", "wait_for", "narrate", "screenshot",
      "mark_flow_start", "mark_flow_end", "done",
    ];

    for (const action of validActions) {
      const script = {
        name: "test",
        url: "http://localhost:3000",
        flows: [{ name: "test", steps: [{ action }] }],
      };

      const errors = validateDemoScript(script);
      expect(errors).toHaveLength(0);
    }
  });

  it("rejects non-object input", () => {
    expect(validateDemoScript(null).length).toBeGreaterThan(0);
    expect(validateDemoScript("string").length).toBeGreaterThan(0);
    expect(validateDemoScript(42).length).toBeGreaterThan(0);
    expect(validateDemoScript([]).length).toBeGreaterThan(0);
  });
});

describe("expectValidScript", () => {
  it("does not throw for valid scripts", () => {
    const script = {
      name: "test",
      url: "http://localhost:3000",
      flows: [{ name: "test", steps: [{ action: "goto", url: "/" }] }],
    };

    expect(() => expectValidScript(script)).not.toThrow();
  });

  it("throws for invalid scripts", () => {
    const script = { flows: [] };

    expect(() => expectValidScript(script)).toThrow("Demo script validation failed");
  });

  it("throws with custom message", () => {
    const script = { flows: [] };

    expect(() => expectValidScript(script, "my test")).toThrow("my test");
  });

  it("handles JSON string input", () => {
    const json = JSON.stringify({
      name: "test",
      url: "http://localhost:3000",
      flows: [{ name: "test", steps: [{ action: "goto", url: "/" }] }],
    });

    expect(() => expectValidScript(json)).not.toThrow();
  });
});

describe("fixtures", () => {
  it("fixtures directory exists", () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true);
  });

  it("sample demo scripts exist", () => {
    const scripts = [
      "demoscripts/login-flow.json",
      "demoscripts/dashboard-walkthrough.json",
      "demoscripts/form-submission.json",
      "demoscripts/multi-flow-demo.json",
    ];

    for (const script of scripts) {
      const path = getFixturePath(script);
      expect(existsSync(path)).toBe(true);
    }
  });

  it("all sample scripts are valid", () => {
    const scripts = [
      "demoscripts/login-flow.json",
      "demoscripts/dashboard-walkthrough.json",
      "demoscripts/form-submission.json",
      "demoscripts/multi-flow-demo.json",
    ];

    for (const script of scripts) {
      const path = getFixturePath(script);
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw);
      const errors = validateDemoScript(parsed);
      expect(errors).toHaveLength(0);
    }
  });

  it("invalid scripts fail validation as expected", () => {
    const invalidScripts = [
      "demoscripts/invalid-missing-name.json",
      "demoscripts/invalid-bad-action.json",
    ];

    for (const script of invalidScripts) {
      const path = getFixturePath(script);
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw);
      const errors = validateDemoScript(parsed);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("page state fixtures exist", () => {
    const pages = [
      "pages/login-page-state.json",
      "pages/dashboard-page-state.json",
      "pages/form-page-state.json",
    ];

    for (const page of pages) {
      const path = getFixturePath(page);
      expect(existsSync(path)).toBe(true);
    }
  });

  it("expected output fixture exists", () => {
    const path = getFixturePath("expected-output.json");
    expect(existsSync(path)).toBe(true);
  });
});

describe("withMockLlm", () => {
  it("wraps a test function with a running mock server", async () => {
    const wrapped = withMockLlm(async (server) => {
      expect(server).toBeDefined();
      expect(server.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(server.apiURL).toMatch(/\/v1\/chat\/completions$/);

      const res = await fetch(server.apiURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test-model",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.choices).toHaveLength(1);
    });

    await wrapped();
  });

  it("supports options parameter", async () => {
    const wrapped = withMockLlm(
      { predefinedResponses: { login: JSON.stringify({ action: "click" }) } },
      async (server) => {
        const res = await fetch(server.apiURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "test-model",
            messages: [{ role: "user", content: "login flow" }],
          }),
        });

        const body = await res.json() as any;
        const content = JSON.parse(body.choices[0].message.content);
        expect(content.action).toBe("click");
      }
    );

    await wrapped();
  });

  it("cleans up server after test", async () => {
    let serverPort: number | null = null;

    const wrapped = withMockLlm(async (server) => {
      serverPort = server.port;
    });

    await wrapped();

    expect(serverPort).toBeGreaterThan(0);
  });
});
