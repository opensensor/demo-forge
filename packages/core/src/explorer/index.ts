/**
 * DemoForge explorer — exploration agent package.
 *
 * Exports:
 * - Guardrails class: origin allowlist, destructive denylist, step/time budgets
 * - Explorer types: config, page state, LLM interface, transcript, progress
 * - ExplorerAgent: main exploration loop
 */

export { Guardrails } from "./guardrails.js";
export { ExplorerAgent } from "./agent-loop.js";
export * from "./types.js";
export {
  Transcript,
  ScriptAssembly,
  HumanConfirmUI,
  truncateContent,
  createTranscriptDir,
  saveTranscriptToFile,
  loadTranscriptFromFile,
  buildDemoScriptFromTranscript,
} from "./transcript.js";
export type {
  TranscriptOptions,
  TurnPayload,
  ScriptAssemblyOptions,
  ScriptAssemblyResult,
  HumanConfirmationResult,
  ConfirmDecision,
  ConfirmCallback,
} from "./transcript.js";
