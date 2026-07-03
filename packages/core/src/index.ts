/**
 * DemoForge core package — types, schemas, and utilities.
 *
 * Exports:
 * - Core types: DemoScript, DemoStep, Viewport, Selector, Effect, etc.
 * - Zod schemas: demoScriptSchema, demoStepSchema, validateDemoScript()
 * - Error types: DemoForgeError, ValidationError, RenderError, etc.
 */

// Types
export * from "./types/index.js";

// Schemas
export * from "./schema/demoScriptSchema.js";

// Errors
export * from "./errors/index.js";
