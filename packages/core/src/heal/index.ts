/**
 * DemoForge core — heal module.
 *
 * LLM-assisted selector repair on replay failure.
 *
 * Exports:
 * - HealEngine: main healing logic
 * - Diff generation for reviewable selector changes
 * - Types for heal configuration, proposals, and results
 */

export { healStep, applyPatches, extractFailingStep } from "./heal-engine.js";
export { generateSelectorDiff, generateYamlDiff, patchesToDiffs } from "./diff.js";

export type {
  FailingStep,
  SelectorPatch,
  HealLlmResponse,
  HealProposal,
  HealResult,
  HealConfig,
  SelectorDiff,
} from "./types.js";
