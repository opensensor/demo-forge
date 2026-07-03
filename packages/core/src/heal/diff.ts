/**
 * DemoForge core — heal diff generation.
 *
 * Generates human-readable, reviewable diffs for selector repairs.
 * Never auto-commits — always presents a reviewable diff.
 */

import type { SelectorDiff, SelectorPatch } from "./types.js";

// ─── Diff Generation ──────────────────────────────────────────────────────────

/**
 * Generate a reviewable diff string for selector patches.
 *
 * Format:
 * ```
 * Step N: <action_type>
 *   Old selector: <old>
 *   New selector: <new>
 *   Reason: <explanation>
 * ```
 */
export function generateSelectorDiff(patches: SelectorPatch[]): string {
  if (patches.length === 0) {
    return "No selector changes proposed.";
  }

  const lines: string[] = [];
  lines.push("=== Selector Repair Diff ===");
  lines.push("");

  for (const patch of patches) {
    lines.push(`Step ${patch.stepIndex}: ${patch.actionType}`);
    lines.push(`  Old selector: ${patch.oldSelector}`);
    lines.push(`  New selector: ${patch.newSelector}`);
    lines.push(`  Confidence:   ${Math.round(patch.confidence * 100)}%`);
    lines.push(`  Reason:       ${patch.explanation}`);
    lines.push("");
  }

  lines.push(`Total patches: ${patches.length}`);
  lines.push("");
  lines.push("Review each change above. Use --accept to auto-apply, or review manually.");

  return lines.join("\n");
}

/**
 * Generate a YAML-formatted diff for the healed script.
 * Shows only the changed steps in a before/after format.
 */
export function generateYamlDiff(patches: SelectorPatch[]): string {
  if (patches.length === 0) {
    return "# No changes proposed\n";
  }

  const lines: string[] = [];
  lines.push("# Selector Repair — Changes Proposed");
  lines.push("");

  for (const patch of patches) {
    lines.push(`# Step ${patch.stepIndex}: ${patch.actionType}`);
    lines.push(`# ---`);
    lines.push(`# - ${patch.actionType}: "${patch.oldSelector}"  # OLD (broken)`);
    lines.push(`# + ${patch.actionType}: "${patch.newSelector}"  # NEW (proposed)`);
    lines.push(`# Reason: ${patch.explanation}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Convert patches to SelectorDiff objects for structured review.
 */
export function patchesToDiffs(patches: SelectorPatch[]): SelectorDiff[] {
  return patches.map((p) => ({
    stepIndex: p.stepIndex,
    actionType: p.actionType,
    oldSelector: p.oldSelector,
    newSelector: p.newSelector,
    explanation: p.explanation,
  }));
}
