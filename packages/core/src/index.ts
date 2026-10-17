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
export * from "./schema/loadDemoScript.js";

// Errors
export * from "./errors/index.js";

// LLM client adapter
export * from "./llm/client.js";
export * from "./llm/types.js";
export {
  createExplorerLlmAdapter,
  extractActionJson,
  type ExplorerAdapterOptions,
} from "./llm/explorer-adapter.js";

// Config
export * from "./config/config.js";

// Explorer agent
export { Guardrails } from "./explorer/guardrails.js";
export * from "./explorer/agent-loop.js";
// Explicitly export explorer types, avoiding conflicts with config/llm
export type {
  LlmActionResponse,
  PageState,
  AccessibilityNode,
  FormField,
  LlmClient as ExplorerLlmClient,
  ProgressEventType,
  ProgressEvent,
  ProgressReporter,
  GuardrailsConfig,
  ExplorerConfig as ExplorerAgentConfig,
  ExplorerActionType,
  ExplorationTurn,
  ExplorationTranscript,
  ScriptAssemblyResult,
  ExplorationResult,
} from "./explorer/types.js";

// Seed hook executor
export * from "./seed/seed.js";

// Heal module (T14)
export * from "./heal/index.js";

// Logger
export { createLogger, createSilentLogger, createDebugLogger } from "./logger.js";
export type { LogLevel, LogEntry, LoggerOptions } from "./logger.js";
