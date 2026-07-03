/**
 * DemoForge core package — types, schemas, and utilities.
 *
 * Exports:
 * - Core types: DemoScript, DemoStep, Viewport, Selector, Effect, etc.
 * - Zod schemas: demoScriptSchema, demoStepSchema, validateDemoScript()
 * - Error types: DemoForgeError, ValidationError, RenderError, etc.
 * - Explorer agent: types, agent loop, guardrails, transcript
 */

// Types
export * from "./types/index.js";

// Schemas
export * from "./schema/demoScriptSchema.js";

// Errors
export * from "./errors/index.js";

// LLM client adapter
export * from "./llm/client.js";
export * from "./llm/types.js";

// Config
export * from "./config/config.js";

// Explorer agent
export * from "./explorer/agent-loop.js";
export * from "./explorer/types.js";
