/**
 * DemoForge core — heal engine.
 *
 * LLM-assisted selector repair on replay failure.
 *
 * Flow:
 * 1. Identify failing step (from render failure or manual input)
 * 2. Capture current AX tree via T10a_agent state serialization
 * 3. Take screenshot via T13_screenshots
 * 4. Send to LLM (T7_llm) with failing step, old selector, and new page state
 * 5. Parse LLM response into selector patch proposal
 * 6. Apply patches to script (never auto-commits)
 * 7. Validate healed script against schema (T2)
 * 8. Return reviewable diff for accept/reject
 */

import { validateDemoScript } from "../schema/demoScriptSchema.js";
import { LlmUnavailableError } from "../errors/index.js";
import type {
  HealConfig,
  HealResult,
  HealProposal,
  FailingStep,
  SelectorPatch,
} from "./types.js";
import { generateSelectorDiff } from "./diff.js";
import type { PageState, AccessibilityNode } from "../explorer/types.js";
import type { BrowserSession } from "@demoforge/browser";

// ─── System Prompt for Healing ────────────────────────────────────────────────

function buildHealSystemPrompt(): string {
  return `You are a DemoForge selector repair assistant. Your job is to fix broken CSS selectors in demo scripts.

When a demo script step fails, you receive:
1. The failing step details (action type, old selector, error message)
2. The current page state (URL, title, accessibility tree, available selectors)
3. A screenshot of the current page (for visual context)

Your task:
- Analyze the failing step and the current page state
- Propose a new, working selector for the same action
- Explain WHY the old selector failed and WHY your new selector should work
- Return your response as a JSON object with a "patches" array

Selector guidelines:
- Prefer role-based selectors: [role="button"][name="Submit"]
- Prefer text-based selectors: button:has-text("Submit")
- Prefer data-testid attributes when available
- Avoid fragile XPath or deep CSS paths
- The selector must be stable and not depend on dynamic content

IMPORTANT: Always return valid JSON with the exact schema:
{
  "patches": [
    {
      "stepIndex": 0,
      "actionType": "click",
      "oldSelector": "the broken selector",
      "newSelector": "your proposed selector",
      "explanation": "why this fixes the problem",
      "confidence": 0.9
    }
  ],
  "explanation": "overall strategy"
}`;
}

function buildHealUserPrompt(
  failingStep: FailingStep,
  pageState: PageState
): string {
  const lines: string[] = [];

  lines.push("## Failing Step");
  lines.push(`Step Index: ${failingStep.stepIndex}`);
  lines.push(`Action Type: ${failingStep.actionType}`);
  lines.push(`Old Selector: ${failingStep.oldSelector}`);
  lines.push(`Error: ${failingStep.error}`);
  lines.push(`URL at failure: ${failingStep.url}`);
  lines.push("");

  lines.push("## Current Page State");
  lines.push(`URL: ${pageState.url}`);
  lines.push(`Title: ${pageState.title}`);
  lines.push(`Viewport: ${pageState.viewport.width}x${pageState.viewport.height}`);
  lines.push("");

  if (pageState.axTree.length > 0) {
    lines.push("## Accessibility Tree");
    for (const node of pageState.axTree) {
      const indent = "  ".repeat(node.depth);
      const selector = node.selector ? ` [${node.selector}]` : "";
      const value = node.value ? ` (value: "${node.value}")` : "";
      lines.push(
        `${indent}- ${node.tag || "?"} [${node.role}]${selector}: "${node.name}"${value}`
      );
    }
    lines.push("");
  }

  if (pageState.formFields.length > 0) {
    lines.push("## Form Fields");
    for (const field of pageState.formFields) {
      lines.push(
        `- ${field.selector}: type="${field.type}", name="${field.name}", value="${field.value}"`
      );
    }
    lines.push("");
  }

  if (pageState.selectors.length > 0) {
    lines.push("## Available Selectors");
    for (const sel of pageState.selectors.slice(0, 30)) {
      lines.push(`- ${sel}`);
    }
    lines.push("");
  }

  lines.push("Propose a new selector for this step. Return JSON.");

  return lines.join("\n");
}

// ─── Page State Serializer (mirrors T10a_agent) ──────────────────────────────

/**
 * Serialize current browser page state for LLM context.
 * Mirrors the serializePageState function from T10a_agent.
 */
async function serializePageState(
  browser: BrowserSession
): Promise<PageState> {
  const browserState = await browser.getState();

  const axTree: AccessibilityNode[] = [];
  const selectors: string[] = [];
  const formFields: import("../explorer/types.js").FormField[] = [];

  try {
    const page = browser.page;
    if (page) {
      const snapshot = await (page as any).accessibility.snapshot();
      if (snapshot) {
        extractAxTree(
          snapshot as Record<string, unknown>,
          axTree,
          selectors,
          formFields,
          0
        );
      }
    }
  } catch {
    // Fallback: build minimal page state without AX tree
  }

  return {
    url: browserState.url,
    title: browserState.title,
    viewport: browserState.viewport,
    axTree,
    selectors,
    formFields,
  };
}

function extractAxTree(
  node: Record<string, unknown>,
  axTree: AccessibilityNode[],
  selectors: string[],
  formFields: import("../explorer/types.js").FormField[],
  depth: number
): void {
  const role = (node.role as string) || "";
  const name = (node.name as string) || "";
  const tag = (node.nodeLabel as string) || "";
  const value = (node.valueObject as Record<string, unknown>)?.value as
    | string
    | undefined;
  const children = node.children as Record<string, unknown>[] | undefined;

  const axNode: AccessibilityNode = {
    role,
    name,
    tag,
    value,
    interactive: isInteractiveRole(role),
    depth,
  };

  const childSelector = extractSelector(node);
  if (childSelector) {
    axNode.selector = childSelector;
    if (!selectors.includes(childSelector)) {
      selectors.push(childSelector);
    }
  }

  if (isFormFieldRole(role) || isFormFieldTag(tag)) {
    formFields.push({
      selector: childSelector || `[role="${role}"]`,
      name: name || "",
      type: role,
      value: value || "",
      placeholder: (node.placeholder as string) || "",
      required: isRequiredRole(role),
    });
  }

  axTree.push(axNode);

  if (children) {
    for (const child of children) {
      extractAxTree(child, axTree, selectors, formFields, depth + 1);
    }
  }
}

function isInteractiveRole(role: string): boolean {
  const interactiveRoles = new Set([
    "button", "link", "textbox", "checkbox", "radio", "combobox",
    "menuitem", "option", "tab", "switch", "slider", "spinbutton",
    "searchbox", "listbox", "treeitem", "gridcell", "cell", "row",
    "columnheader", "rowheader", "menu", "list", "tree", "tablist",
    "toolbar", "navigation", "main", "contentinfo", "banner",
  ]);
  return interactiveRoles.has(role);
}

function isFormFieldRole(role: string): boolean {
  const formRoles = new Set([
    "textbox", "combobox", "listbox", "spinbutton", "slider",
    "checkbox", "radio", "switch",
  ]);
  return formRoles.has(role);
}

function isFormFieldTag(tag: string): boolean {
  const formTags = new Set(["input", "select", "textarea"]);
  return formTags.has(tag.toLowerCase());
}

function isRequiredRole(role: string): boolean {
  const requiredRoles = new Set([
    "textbox", "checkbox", "radio", "combobox", "listbox", "spinbutton",
  ]);
  return requiredRoles.has(role);
}

function extractSelector(node: Record<string, unknown>): string | null {
  const domRef = node.domElement as string;
  if (domRef) {
    const tagMatch = domRef.match(/<(\w+)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const role = (node.role as string) || "";
      const name = (node.name as string) || "";

      if (role && name) {
        const escapedName = name.replace(/"/g, '\\"');
        return `[role="${role}"][name="${escapedName}"]`;
      }
      if (role) {
        return `[role="${role}"]`;
      }
      return tag || null;
    }
  }

  const text = (node.name as string) || "";
  if (text) {
    const tag = (node.nodeLabel as string) || "span";
    const escapedText = text.replace(/"/g, '\\"');
    return `${tag}:has-text("${escapedText}")`;
  }

  return null;
}

// ─── Screenshot Capture (mirrors T13_screenshots) ────────────────────────────

/**
 * Capture a screenshot buffer from the browser.
 * Mirrors T13_screenshots functionality.
 */
async function captureScreenshot(
  browser: BrowserSession
): Promise<Buffer> {
  return await browser.screenshot({ fullPage: true, type: "png" });
}

/**
 * Convert a buffer to base64 for LLM context (VLM-assisted healing).
 */
function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

// ─── LLM Request ──────────────────────────────────────────────────────────────

/**
 * Send a healing request to the LLM.
 * Returns parsed HealLlmResponse or throws on failure.
 */
async function sendHealRequest(
  llmClient: import("../llm/client.js").LlmClient,
  failingStep: FailingStep,
  pageState: PageState,
  _screenshotBase64?: string
): Promise<{ patches: SelectorPatch[]; explanation: string }> {
  const systemPrompt = buildHealSystemPrompt();
  const userPrompt = buildHealUserPrompt(failingStep, pageState);
  // Include user prompt in system context for the LLM
  const fullSystemPrompt = systemPrompt + "\n\n" + userPrompt;

  const response = await llmClient.sendRequest({
    messages: [{ role: "system", content: fullSystemPrompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 2048,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(content); // SyntaxError handled by healStep
  if (!parsed || typeof parsed !== "object") {
    throw new SyntaxError("LLM healing response is not a JSON object");
  }

  return {
    patches: (parsed.patches ?? []).map((p: Record<string, unknown>) => ({
      stepIndex: Number(p.stepIndex ?? 0),
      actionType: String(p.actionType ?? "unknown"),
      oldSelector: String(p.oldSelector ?? ""),
      newSelector: String(p.newSelector ?? ""),
      explanation: String(p.explanation ?? "No explanation provided"),
      confidence: Math.min(
        1,
        Math.max(0, Number(p.confidence ?? 0.5))
      ),
    })),
    explanation: String(parsed.explanation ?? ""),
  };
}

// ─── Script Patching ──────────────────────────────────────────────────────────

/**
 * Apply selector patches to a demo script.
 * Returns a new script object with patches applied (immutable).
 * Never auto-commits — always returns a new object.
 */
export function applyPatches(
  script: import("../types/index.js").DemoScript,
  patches: SelectorPatch[]
): import("../types/index.js").DemoScript {
  const steps = script.steps.map((step, index) => {
    const patch = patches.find((p) => p.stepIndex === index);
    if (!patch) return step;

    // Apply the patch based on action type
    if ("click" in step) {
      return { ...step, click: patch.newSelector };
    }
    if ("hover" in step) {
      return { ...step, hover: patch.newSelector };
    }
    if (
      "fill" in step &&
      typeof step.fill === "object" &&
      step.fill &&
      "target" in step.fill
    ) {
      return {
        ...step,
        fill: { ...step.fill, target: patch.newSelector },
      };
    }
    if (
      "select" in step &&
      typeof step.select === "object" &&
      step.select &&
      "target" in step.select
    ) {
      return {
        ...step,
        select: { ...step.select, target: patch.newSelector },
      };
    }
    if (
      "wait_for" in step &&
      typeof step.wait_for === "object" &&
      step.wait_for &&
      "selector" in step.wait_for
    ) {
      return {
        ...step,
        wait_for: { ...step.wait_for, selector: patch.newSelector },
      };
    }

    // For string selectors (simple cases)
    for (const key of ["click", "hover"] as const) {
      const val = (step as unknown as Record<string, unknown>)[key];
      if (typeof val === "string") {
        return { ...step, [key]: patch.newSelector };
      }
    }

    return step;
  });

  return { ...script, steps };
}

// ─── Failing Step Extraction ──────────────────────────────────────────────────

/**
 * Extract failing step information from a script and failure error.
 */
export function extractFailingStep(
  script: import("../types/index.js").DemoScript,
  stepIndex: number,
  error: string,
  url: string
): FailingStep | null {
  if (stepIndex < 0 || stepIndex >= script.steps.length) {
    return null;
  }

  const step = script.steps[stepIndex];
  if (!step) {
    return null;
  }

  const actionType = getActionType(step);
  const oldSelector = getSelector(step);

  if (!oldSelector) {
    // Steps without selectors (goto, narrate, done, etc.) can't be healed
    return null;
  }

  return {
    stepIndex,
    step,
    actionType,
    oldSelector,
    error,
    url,
  };
}

function getActionType(step: import("../types/index.js").DemoStep): string {
  if ("goto" in step) return "goto";
  if ("click" in step) return "click";
  if ("hover" in step) return "hover";
  if ("fill" in step) return "fill";
  if ("select" in step) return "select";
  if ("press" in step) return "press";
  if ("scroll" in step) return "scroll";
  if ("wait_for" in step) return "wait_for";
  if ("narrate" in step) return "narrate";
  if ("screenshot" in step) return "screenshot";
  if ("mark_flow_start" in step) return "mark_flow_start";
  if ("mark_flow_end" in step) return "mark_flow_end";
  if ("done" in step) return "done";
  if ("pause" in step) return "pause";
  return "unknown";
}

function getSelector(step: import("../types/index.js").DemoStep): string | null {
  if ("click" in step && typeof step.click === "string") return step.click;
  if ("hover" in step && typeof step.hover === "string") return step.hover;
  if (
    "fill" in step &&
    typeof step.fill === "object" &&
    step.fill &&
    "target" in step.fill
  ) {
    const target = step.fill.target;
    if (typeof target === "string") return target;
    if (typeof target === "object" && "css" in target) return target.css;
    if (typeof target === "object" && "role" in target)
      return `[role="${target.role}"]`;
  }
  if (
    "select" in step &&
    typeof step.select === "object" &&
    step.select &&
    "target" in step.select
  ) {
    const target = step.select.target;
    if (typeof target === "string") return target;
    if (typeof target === "object" && "css" in target) return target.css;
  }
  if (
    "wait_for" in step &&
    typeof step.wait_for === "object" &&
    step.wait_for &&
    "selector" in step.wait_for
  ) {
    const sel = step.wait_for.selector;
    if (typeof sel === "string") return sel;
    if (typeof sel === "object" && "css" in sel) return sel.css;
  }
  return null;
}

// ─── Main Heal Engine ─────────────────────────────────────────────────────────

/**
 * Execute the heal flow for a failing demo script.
 *
 * 1. Captures current AX tree via T10a_agent state serialization
 * 2. Takes screenshot via T13_screenshots
 * 3. Sends to LLM (T7_llm) with failing step, old selector, and new page state
 * 4. LLM proposes selector patch as reviewable diff (never auto-commits)
 * 5. Diff shows old vs new selector with explanation
 * 6. Accept/reject workflow: --accept flag for automated approval, interactive mode for manual review
 * 7. Healed script validated against schema (T2) before saving
 */
export async function healStep(
  config: HealConfig & {
    failingStep: FailingStep;
  }
): Promise<HealResult> {
  const { failingStep, script, browser, llmClient, accept, screenshotPath } = config;

  const proposals: HealProposal[] = [];

  // Step 1: Capture current AX tree via T10a_agent state serialization
  let pageState: PageState;
  try {
    pageState = await serializePageState(browser);
  } catch (err) {
    return {
      success: false,
      error: `Failed to capture page state: ${err instanceof Error ? err.message : String(err)}`,
      proposals: [],
      llmUnavailable: false,
      patchesApplied: 0,
    };
  }

  // Step 2: Take screenshot via T13_screenshots
  let screenshotBase64: string | undefined;
  try {
    const screenshotBuffer = await captureScreenshot(browser);
    screenshotBase64 = bufferToBase64(screenshotBuffer);

    if (screenshotPath) {
      const fs = await import("node:fs");
      await fs.promises.writeFile(screenshotPath, screenshotBuffer);
    }
  } catch (err) {
    console.warn(
      `Warning: Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Step 3: Send to LLM with failing step, old selector, and new page state
  let llmResponse: { patches: SelectorPatch[]; explanation: string };

  try {
    llmResponse = await sendHealRequest(llmClient, failingStep, pageState, screenshotBase64);
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return {
        success: false,
        error: `LLM server is unavailable. Cannot propose selector repairs. ${err.message} Ensure llama-server or an OpenAI-compatible API is running.`,
        proposals: [],
        llmUnavailable: true,
        patchesApplied: 0,
      };
    }
    if (err instanceof SyntaxError) {
      return {
        success: false,
        error: `LLM returned malformed JSON for healing proposal: ${err.message}`,
        proposals: [],
        llmUnavailable: false,
        patchesApplied: 0,
      };
    }
    throw err;
  }

  // Step 4: Generate reviewable diff (never auto-commits)
  let patches = llmResponse.patches.filter(
    (p) => p.stepIndex === failingStep.stepIndex
  );

  if (patches.length === 0) {
    // LLM didn't propose patches for this specific step
    // Use all patches, remapping step indices to the failing step
    patches = llmResponse.patches.map((p) => ({
      ...p,
      stepIndex: failingStep.stepIndex,
      actionType: failingStep.actionType,
      oldSelector: failingStep.oldSelector,
    }));
  }

  if (patches.length === 0) {
    // LLM proposed nothing — there is no patch to review or apply
    return {
      success: false,
      error: "LLM proposed no selector patches for the failing step. Nothing to apply; re-run heal or fix the selector manually.",
      proposals: [],
      llmUnavailable: false,
      patchesApplied: 0,
    };
  }

  const diff = generateSelectorDiff(patches);

  // Step 5: Apply patches and validate
  let healedScript: import("../types/index.js").DemoScript | undefined;
  let schemaValid = false;

  if (patches.length > 0) {
    healedScript = applyPatches(script, patches);

    // Step 6: Validate healed script against schema (T2)
    const validation = validateDemoScript(healedScript);
    schemaValid = validation.success;

    if (!schemaValid) {
      return {
        success: false,
        error: `Healed script failed schema validation: ${(validation as any).error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        proposals: [],
        llmUnavailable: false,
        patchesApplied: 0,
      };
    }
  }

  // Step 7: Accept/reject workflow
  const accepted = accept === true;

  const proposal: HealProposal = {
    failingStep,
    patches,
    axTree: pageState.axTree,
    pageState,
    screenshotBase64,
    accepted,
    healedScript: accepted ? healedScript : undefined,
    diff,
  };

  proposals.push(proposal);

  const patchesApplied = accepted ? patches.length : 0;

  if (!accepted) {
    return {
      success: false,
      error: "Healing proposals generated but not accepted. Use --accept to auto-apply.",
      proposals,
      llmUnavailable: false,
      patchesApplied: 0,
    };
  }

  return {
    success: true,
    script: healedScript,
    proposals,
    llmUnavailable: false,
    patchesApplied,
  };
}
