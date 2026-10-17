/**
 * Demo Script loading — read JSON/YAML from disk, resolve environment
 * references, and validate against the schema.
 *
 * Any string value may contain `${env:NAME}` references, which are replaced
 * with `process.env.NAME` at load time. This keeps credentials out of
 * committed scripts: `{ "fill": { "target": "#password", "value": "${env:APP_PASS}" } }`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";

import type { DemoScript } from "../types/index.js";
import { ValidationError } from "../errors/index.js";
import { demoScriptSchema } from "./demoScriptSchema.js";

const ENV_REF = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replace `${env:NAME}` references in every string of `value`.
 * Throws a ValidationError naming every missing variable.
 */
export function resolveEnvRefs<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  const missing = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return node.replace(ENV_REF, (_match, name: string) => {
        const resolved = env[name];
        if (resolved === undefined) {
          missing.add(name);
          return "";
        }
        return resolved;
      });
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  const result = walk(value) as T;
  if (missing.size > 0) {
    throw new ValidationError(
      `Missing environment variable(s) referenced by the demo script: ${[...missing].join(", ")}`,
    );
  }
  return result;
}

/** Parse, resolve env references in, and validate a Demo Script object. */
export function parseDemoScript(raw: unknown, env: NodeJS.ProcessEnv = process.env): DemoScript {
  const resolved = resolveEnvRefs(raw, env);
  const result = demoScriptSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    }));
    const summary = issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ValidationError(`Invalid demo script: ${summary}`, { issues });
  }
  return result.data as DemoScript;
}

function readScriptFile(filePath: string): Record<string, unknown> {
  const text = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();
  const raw = ext === ".json" ? JSON.parse(text) : yaml.load(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(`${filePath}: demo script must be an object`);
  }
  return raw as Record<string, unknown>;
}

/**
 * Read a script file, applying `extends`: the named base file (relative to
 * this one, itself possibly extending another) supplies defaults that this
 * file's top-level keys override. Useful for sharing viewport, login setup,
 * and redaction rules across a suite of demos.
 */
function readWithExtends(filePath: string, seen: Set<string> = new Set()): Record<string, unknown> {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) {
    throw new ValidationError(`${filePath}: circular "extends"`);
  }
  seen.add(resolved);

  const raw = readScriptFile(resolved);
  const { extends: base, ...own } = raw;
  if (base === undefined) {
    return own;
  }
  if (typeof base !== "string") {
    throw new ValidationError(`${filePath}: "extends" must be a file path`);
  }
  return { ...readWithExtends(path.resolve(path.dirname(resolved), base), seen), ...own };
}

/** Load a Demo Script from a .json, .yaml, or .yml file. */
export function loadDemoScript(filePath: string, env: NodeJS.ProcessEnv = process.env): DemoScript {
  const raw = readWithExtends(filePath);
  try {
    return parseDemoScript(raw, env);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new ValidationError(`${filePath}: ${err.message}`, { issues: err.issues });
    }
    throw err;
  }
}

/**
 * Load a partial script (e.g. a shared `_base.yaml`) without validating it
 * as a complete demo. Returns both the raw form (env references intact, for
 * writing new scripts) and the resolved form (for use now).
 */
export function loadScriptFragment(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): { raw: Partial<DemoScript>; resolved: Partial<DemoScript> } {
  const raw = readWithExtends(filePath) as Partial<DemoScript>;
  return { raw, resolved: resolveEnvRefs(raw, env) };
}
