/**
 * Integration test utilities — shared helpers for running the full DemoForge pipeline.
 */

import http from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, createReadStream } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_WEB_APP_DIR = join(__dirname, "..", "..", "test", "fixtures", "mock-web-app");

// ---------------------------------------------------------------------------
// Mock Web Server (Node built-in HTTP — no npx dependency)
// ---------------------------------------------------------------------------

export interface MockWebServer {
  port: number;
  baseURL: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

let nextWebPort = 3200;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export function createMockWebServer(port?: number): MockWebServer {
  const serverPort = port ?? nextWebPort++;
  let server: http.Server | null = null;

  return {
    get port() {
      return serverPort;
    },
    get baseURL() {
      return `http://localhost:${serverPort}`;
    },
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          // Map URL to file path
          let filePath = req.url!.split("?")[0]!;
          if (filePath === "/" || filePath === "") filePath = "/index.html";

          let fullPath = join(MOCK_WEB_APP_DIR, filePath);

          // If file doesn't exist, try appending .html
          if (!existsSync(fullPath)) {
            const htmlPath = fullPath + ".html";
            if (existsSync(htmlPath)) {
              fullPath = htmlPath;
            }
          }

          if (!existsSync(fullPath)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            return;
          }

          const ext = fullPath.slice(fullPath.lastIndexOf("."));
          const contentType = MIME_TYPES[ext] || "application/octet-stream";

          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
          });

          const stream = createReadStream(fullPath);
          stream.pipe(res);
        });

        // Safety timeout — only fires if the server never starts listening
        const startTimeout = setTimeout(() => {
          server?.close();
          reject(new Error("Mock web server start timeout"));
        }, 10000);
        startTimeout.unref();

        server.listen(serverPort, "127.0.0.1", () => {
          clearTimeout(startTimeout);
          resolve();
        });

        server.on("error", (err) => {
          clearTimeout(startTimeout);
          reject(new Error(`Mock web server failed to start: ${err.message}`));
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        // Force-resolve if close callbacks never fire (open keep-alive sockets)
        const forceTimeout = setTimeout(() => resolve(), 3000);
        forceTimeout.unref();
        server.closeAllConnections?.();
        server.close(() => {
          clearTimeout(forceTimeout);
          resolve();
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Temp Directory Helpers
// ---------------------------------------------------------------------------

export interface TempProject {
  dir: string;
  cleanup(): void;
}

export function createTempProject(): TempProject {
  const dir = join(
    process.cwd(),
    "test-output",
    `integration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });

  return {
    get dir() {
      return dir;
    },
    cleanup() {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Demo Script Helpers
// ---------------------------------------------------------------------------

export interface DemoScriptFixture {
  name: string;
  url: string;
  flows: Array<{
    name: string;
    description?: string;
    steps: Array<Record<string, unknown>>;
  }>;
}

/**
 * Create a simple demo script for testing against the mock web app.
 */
export function createSimpleLoginScript(
  baseUrl: string
): DemoScriptFixture {
  return {
    name: "login-flow",
    url: baseUrl,
    flows: [
      {
        name: "login-success",
        description: "User logs in successfully",
        steps: [
          { action: "goto", url: `${baseUrl}/login` },
          { action: "wait_for", text: "Sign In" },
          { action: "fill", selector: { role: "textbox", name: "email" }, value: "user@example.com" },
          { action: "fill", selector: { role: "textbox", name: "password" }, value: "password123" },
          { action: "click", selector: { role: "button", name: "Sign In" } },
          { action: "wait_for", text: "Dashboard" },
          { action: "narrate", text: "User logged in successfully" },
          { action: "done" },
        ],
      },
    ],
  };
}

/**
 * Create a dashboard walkthrough script.
 */
export function createDashboardScript(
  baseUrl: string
): DemoScriptFixture {
  return {
    name: "dashboard-walkthrough",
    url: baseUrl,
    flows: [
      {
        name: "view-dashboard",
        description: "Navigate to and view the dashboard",
        steps: [
          { action: "goto", url: `${baseUrl}/dashboard` },
          { action: "wait_for", text: "Welcome back" },
          { action: "screenshot", label: "dashboard-overview" },
          { action: "narrate", text: "The dashboard shows key metrics" },
          { action: "done" },
        ],
      },
    ],
  };
}

/**
 * Create a form submission script.
 */
export function createFormScript(
  baseUrl: string
): DemoScriptFixture {
  return {
    name: "form-submission",
    url: baseUrl,
    flows: [
      {
        name: "submit-form",
        description: "Fill and submit the contact form",
        steps: [
          { action: "goto", url: `${baseUrl}/form` },
          { action: "wait_for", text: "Contact Form" },
          { action: "fill", selector: { role: "textbox", name: "name" }, value: "Test User" },
          { action: "fill", selector: { role: "textbox", name: "email" }, value: "test@example.com" },
          { action: "select", selector: { role: "combobox", name: "subject" }, value: "support" },
          { action: "fill", selector: { role: "textbox", name: "message" }, value: "Hello from DemoForge!" },
          { action: "click", selector: { role: "button", name: "Submit" } },
          { action: "wait_for", text: "Thank you" },
          { action: "done" },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Script File Helpers
// ---------------------------------------------------------------------------

export function writeScriptFile(
  dir: string,
  name: string,
  script: DemoScriptFixture
): string {
  const filePath = join(dir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(script, null, 2), "utf-8");
  return filePath;
}

export function readScriptFile(dir: string, name: string): unknown {
  const filePath = join(dir, `${name}.json`);
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

export function listScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.filter(
    (f) => f.endsWith(".json") || f.endsWith(".yaml") || f.endsWith(".yml")
  );
}

// ---------------------------------------------------------------------------
// Verification Helpers
// ---------------------------------------------------------------------------

export function assertFileExists(
  path: string,
  message?: string
): void {
  if (!existsSync(path)) {
    throw new Error(message ?? `File does not exist: ${path}`);
  }
}

export function assertDirExists(
  dir: string,
  message?: string
): void {
  if (!existsSync(dir) || !readFileSync(dir, { encoding: "utf-8" }) || false) {
    // existsSync check is sufficient
  }
  if (!existsSync(dir)) {
    throw new Error(message ?? `Directory does not exist: ${dir}`);
  }
}

export function assertHtmlValid(
  html: string,
  checks?: {
    hasTitle?: boolean;
    hasVideo?: boolean;
    hasEmbed?: boolean;
    hasCss?: boolean;
    hasJs?: boolean;
  }
): void {
  const errors: string[] = [];

  if (!html.includes("<!DOCTYPE html>") && !html.includes("<html")) {
    errors.push("Missing HTML document declaration");
  }

  if (!html.includes("<head")) {
    errors.push("Missing <head> section");
  }

  if (!html.includes("</html>") && !html.includes("<html")) {
    errors.push("Missing </html> closing tag");
  }

  if (checks?.hasTitle && !html.includes("<title")) {
    errors.push("Missing <title> tag");
  }

  if (checks?.hasVideo && !html.includes("<video") && !html.includes("<source")) {
    errors.push("Missing video element");
  }

  if (checks?.hasEmbed && !html.includes("embed") && !html.includes("source") && !html.includes("video")) {
    errors.push("Missing embedded media");
  }

  if (checks?.hasCss && !html.includes("<style") && !html.includes("href=") && !html.includes(".css")) {
    errors.push("Missing CSS reference");
  }

  if (checks?.hasJs && !html.includes("<script") && !html.includes(".js")) {
    errors.push("Missing JavaScript reference");
  }

  if (errors.length > 0) {
    throw new Error(`HTML validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

export function assertScriptValid(
  script: unknown,
  message?: string
): void {
  const errors: string[] = [];

  if (!script || typeof script !== "object") {
    throw new Error(message ?? "Script must be a non-null object");
  }

  const s = script as Record<string, unknown>;

  // Support two formats:
  // 1. Fixture format: { name, url, flows: [{ name, steps: [{ action, ... }] }] }
  // 2. Renderer format: { demo, title, viewport, narration_mode, steps: [{ goto|click|... }] }

  const isRendererFormat = "demo" in s && "steps" in s;
  const isFixtureFormat = "name" in s && "flows" in s;

  if (!isRendererFormat && !isFixtureFormat) {
    errors.push("Script must have either 'demo'/'steps' (renderer format) or 'name'/'flows' (fixture format)");
  }

  if (isFixtureFormat) {
    if (!s.name || typeof s.name !== "string") {
      errors.push("Missing or invalid 'name' field");
    }
    if (!s.url || typeof s.url !== "string") {
      errors.push("Missing or invalid 'url' field");
    }
    if (!s.flows || !Array.isArray(s.flows)) {
      errors.push("Missing or invalid 'flows' field");
    } else {
      for (let i = 0; i < s.flows.length; i++) {
        const flow = s.flows[i] as Record<string, unknown>;
        if (!flow.name || typeof flow.name !== "string") {
          errors.push(`Flow at index ${i} missing 'name'`);
        }
        if (!flow.steps || !Array.isArray(flow.steps)) {
          errors.push(`Flow '${flow.name || i}' missing 'steps' array`);
        } else {
          for (let j = 0; j < flow.steps.length; j++) {
            const step = flow.steps[j] as Record<string, unknown>;
            if (!step.action) {
              errors.push(`Step at index ${j} in flow '${flow.name}' missing 'action'`);
            }
          }
        }
      }
    }
  }

  if (isRendererFormat) {
    if (!s.demo || typeof s.demo !== "string") {
      errors.push("Missing or invalid 'demo' field");
    }
    if (!s.steps || !Array.isArray(s.steps)) {
      errors.push("Missing or invalid 'steps' field");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      message
        ? `${message}\nValidation errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`
        : `Demo script validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }
}
