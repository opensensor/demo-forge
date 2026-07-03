/**
 * Shared test utilities for DemoForge.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MockLlmServer, createMockLlmServer, type MockLlmServerOptions } from "./mock-llm-server.js";

// ─── Fixtures path resolution ───
// The test-utils package lives at packages/test-utils/src/, fixtures are at test/fixtures/
// We need to resolve from the project root.
const _resolved = new URL("../../..", import.meta.url);
export const FIXTURES_DIR = join(_resolved.pathname, "test", "fixtures");

/**
 * Validate that a demo script object has the required top-level fields
 * and that all steps have a valid action type.
 */
const VALID_ACTIONS = new Set([
  "goto",
  "click",
  "hover",
  "fill",
  "select",
  "press",
  "scroll",
  "wait_for",
  "narrate",
  "screenshot",
  "mark_flow_start",
  "mark_flow_end",
  "done",
]);

export function validateDemoScript(script: unknown): string[] {
  const errors: string[] = [];

  if (!script || typeof script !== "object") {
    errors.push("Demo script must be a non-null object");
    return errors;
  }

  const s = script as Record<string, unknown>;

  if (!s.name || typeof s.name !== "string") {
    errors.push("Missing or invalid 'name' field (must be a string)");
  }

  if (!s.url || typeof s.url !== "string") {
    errors.push("Missing or invalid 'url' field (must be a string)");
  }

  if (!s.flows || !Array.isArray(s.flows)) {
    errors.push("Missing or invalid 'flows' field (must be an array)");
    return errors;
  }

  for (let i = 0; i < s.flows.length; i++) {
    const flow = s.flows[i];
    if (!flow || typeof flow !== "object") {
      errors.push(`Flow at index ${i} must be an object`);
      continue;
    }
    const f = flow as Record<string, unknown>;

    if (!f.name || typeof f.name !== "string") {
      errors.push(`Flow at index ${i} missing 'name' field`);
    }

    if (!f.steps || !Array.isArray(f.steps)) {
      errors.push(`Flow '${f.name || i}' missing 'steps' array`);
      continue;
    }

    for (let j = 0; j < f.steps.length; j++) {
      const step = f.steps[j];
      if (!step || typeof step !== "object") {
        errors.push(`Step at index ${j} in flow '${f.name}' must be an object`);
        continue;
      }
      const st = step as Record<string, unknown>;
      const action = st.action as string | undefined;
      if (!action) {
        errors.push(`Step at index ${j} in flow '${f.name}' missing 'action' field`);
      } else if (!VALID_ACTIONS.has(action)) {
        errors.push(
          `Step at index ${j} in flow '${f.name}' has unknown action '${action}'. Valid actions: ${[...VALID_ACTIONS].join(", ")}`
        );
      }
    }
  }

  return errors;
}

export function getFixturePath(...segments: string[]): string {
  return join(FIXTURES_DIR, ...segments);
}

export function loadFixture<T = unknown>(...segments: string[]): T {
  const path = getFixturePath(...segments);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as T;
}

export interface TestScriptFixture {
  path: string;
  content: unknown;
  raw: string;
}

export function loadScriptFixture(...segments: string[]): TestScriptFixture {
  const path = getFixturePath(...segments);
  if (!existsSync(path)) {
    throw new Error(`Script fixture not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  return {
    path,
    content: JSON.parse(raw),
    raw,
  };
}

export function expectValidScript(
  script: unknown | string,
  message?: string
): void {
  let parsed: unknown;

  if (typeof script === "string") {
    try {
      parsed = JSON.parse(script);
    } catch {
      parsed = script;
    }
  } else {
    parsed = script;
  }

  const errors = validateDemoScript(parsed);

  if (errors.length > 0) {
    const msg = message
      ? `${message}\nValidation errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`
      : `Demo script validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
    throw new Error(msg);
  }
}

interface RenderOutputExpectations {
  outputDir: string;
  extensions?: string[];
  minFiles?: number;
  flowNames?: string[];
}

export async function expectRenderOutput(
  options: RenderOutputExpectations
): Promise<void> {
  const { outputDir, extensions = [".mp4", ".webm", ".gif", ".png"], minFiles = 1, flowNames } = options;

  const { readdirSync } = await import("node:fs");
  const { join: pathJoin } = await import("node:path");

  const dir = pathJoin(process.cwd(), outputDir);

  if (!existsSync(dir)) {
    throw new Error(`Render output directory not found: ${dir}`);
  }

  const files = readdirSync(dir).filter((f) => {
    const ext = "." + f.split(".").pop();
    return extensions.includes(ext);
  });

  if (files.length < minFiles) {
    throw new Error(
      `Expected at least ${minFiles} render output files, found ${files.length} in ${dir}. Files: ${files.join(", ")}`
    );
  }

  if (flowNames) {
    const fileBasename = (f: string) => f.replace(/\.[^.]+$/, "").split("-")[0];
    const foundNames = new Set(files.map(fileBasename));
    const missing = flowNames.filter((n) => !foundNames.has(n));
    if (missing.length > 0) {
      throw new Error(
        `Expected flow names ${missing.join(", ")} in output, found: ${[...foundNames].join(", ")}`
      );
    }
  }
}

interface WithMockLlmOptions extends MockLlmServerOptions {
  responsePrefix?: string;
}

export function withMockLlm(
  fn: (server: MockLlmServer) => Promise<void>
): () => Promise<void>;
export function withMockLlm(
  options: WithMockLlmOptions,
  fn: (server: MockLlmServer) => Promise<void>
): () => Promise<void>;
export function withMockLlm(
  a: WithMockLlmOptions | ((server: MockLlmServer) => Promise<void>),
  b?: (server: MockLlmServer) => Promise<void>
): () => Promise<void> {
  let options: WithMockLlmOptions = {};
  let fn: (server: MockLlmServer) => Promise<void>;

  if (typeof a === "function") {
    fn = a;
  } else {
    options = a;
    if (!b) throw new Error("withMockLlm: callback function is required");
    fn = b;
  }

  return async () => {
    const server = await createMockLlmServer(options);
    try {
      await fn(server);
    } finally {
      await server.close();
    }
  };
}
