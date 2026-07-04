/**
 * DemoForge explorer — main exploration agent loop.
 *
 * Each turn: serialize page state -> call LLM with system prompt + action schema
 * -> parse constrained response -> execute action via browser -> record step ->
 * repeat until `done` or budget exhausted.
 *
 * System prompt includes: action space description, goal context, guardrails
 * (allowlist origin, block destructive buttons/routes), step/time budgets.
 *
 * Exploration transcript: full turn log (state sent, response received, action
 * executed) for debugging.
 *
 * Script assembly: collects all steps into valid Demo Script (validated via T2 schema).
 *
 * Human confirm step after discovery mode (proposes flows, asks for confirmation).
 *
 * Progress reporting via shared ProgressReporter interface.
 */

import type { BrowserSession } from "@demoforge/browser";
import type {
  ExplorerConfig,
  ExplorerActionType,
  LlmActionResponse,
  ProgressEvent,
  ExplorationTranscript,
  ExplorationResult,
  PageState,
  AccessibilityNode,
  FormField,
  OpenDialog,
} from "./types.js";
import { Guardrails } from "./guardrails.js";

// ─── Valid Action Types ──────────────────────────────────────────────────────

const VALID_ACTIONS: ReadonlySet<ExplorerActionType> = new Set<ExplorerActionType>([
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
  "pause",
]);

// ─── Action Schema for LLM JSON Constraint ───────────────────────────────────

/**
 * JSON schema that constrains LLM responses to valid action types.
 * This is passed as the response_format json_schema to the LLM.
 */
function buildActionSchema(): Record<string, unknown> {
  return {
    name: "explorer_action",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: Array.from(VALID_ACTIONS) as string[],
          description:
            "The action type to execute. Must be one of the valid action types.",
        },
        params: {
          type: "object",
          description: "Action parameters. Structure depends on action type.",
          additionalProperties: true,
        },
        narration: {
          type: "string",
          description: "Narration text for narrate steps.",
        },
        notes: {
          type: "string",
          description: "Notes explaining the LLM's reasoning.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  };
}

// ─── System Prompt Builder ───────────────────────────────────────────────────

/**
 * Builds the system prompt for the explorer agent.
 * Includes action space description, goal context, guardrails, and budgets.
 */
function buildSystemPrompt(config: ExplorerConfig): string {
  const lines: string[] = [];

  // Identity and purpose
  lines.push("You are an expert web exploration agent for DemoForge.");
  lines.push("");

  // Action space description
  lines.push("## Action Space");
  lines.push("You can perform the following actions on web pages:");
  lines.push("");
  lines.push("- `goto`: Navigate to a URL. Params: { url: string }");
  lines.push("- `click`: Click an element. Params: { selector: string }");
  lines.push("- `hover`: Hover over an element. Params: { selector: string }");
  lines.push("- `fill`: Fill a form field. Params: { selector: string, value: string }");
  lines.push("- `select`: Select an option from a dropdown. Params: { selector: string, value: string }");
  lines.push("- `press`: Press a keyboard key. Params: { key: string }");
  lines.push("- `scroll`: Scroll the page. Params: { amount: number }");
  lines.push("- `wait_for`: Wait for a condition. Params: { text: string } or { selector: string }");
  lines.push("- `narrate`: Add narration text. Params: {} (use narration field for text)");
  lines.push("- `screenshot`: Take a screenshot. Params: {}");
  lines.push("- `mark_flow_start`: Mark the start of a flow. Params: { name: string }");
  lines.push("- `mark_flow_end`: Mark the end of a flow. Params: { name: string }");
  lines.push("- `pause`: Pause for a duration. Params: { duration: number }");
  lines.push("- `done`: End the exploration session. Params: {}");
  lines.push("");
  lines.push("Selectors MUST be copied verbatim from the \"Interactive Elements\" list in");
  lines.push("the page state (e.g. `#incident-search` or `role=button[name=\"Allowlist\" i]`).");
  lines.push("Never invent CSS paths — if the element you need is not listed, scroll or");
  lines.push("navigate to reveal it first.");
  lines.push("");

  // Goal context
  lines.push("## Demo Goal");
  lines.push(`Goal: ${config.goal}`);
  lines.push("");
  lines.push("Your task is to explore the target website and demonstrate its key features.");
  lines.push("Think step by step about what actions would best showcase the product.");
  lines.push("");

  // Guardrails
  lines.push("## Guardrails");
  lines.push("You MUST follow these rules:");
  lines.push("");

  // Origin allowlist
  if (config.guardrails?.allowedOrigins && config.guardrails.allowedOrigins.length > 0) {
    lines.push(
      `- Only navigate within these origins: ${config.guardrails.allowedOrigins.join(", ")}`
    );
    lines.push("");
  }

  // Destructive action blocking
  if (config.guardrails?.destructiveButtonPatterns) {
    lines.push(
      `- NEVER click buttons matching these patterns: ${config.guardrails.destructiveButtonPatterns.join(", ")}`
    );
  }
  if (config.guardrails?.destructiveUrlPatterns) {
    lines.push(
      `- NEVER navigate to URLs matching these patterns: ${config.guardrails.destructiveUrlPatterns.join(", ")}`
    );
  }
  if (
    !config.guardrails?.destructiveButtonPatterns &&
    !config.guardrails?.destructiveUrlPatterns
  ) {
    lines.push(
      `- NEVER click destructive buttons like "Delete account", "Reset", "Empty database", "Permanently delete", or "Wipe data"`
    );
  }
  lines.push("");

  // Step budget
  lines.push(`## Step Budget`);
  lines.push(`You have a maximum of ${config.maxSteps} steps.`);
  lines.push("");

  // Time budget
  lines.push(`## Time Budget`);
  lines.push(`You have a maximum of ${config.maxTime}ms total time.`);
  lines.push("");

  // Response format
  lines.push("## Response Format");
  lines.push("Return a JSON object with the following structure:");
  lines.push('{ "action": "<action_type>", "params": { ... }, "notes": "<reasoning>" }');
  lines.push("");

  // Strategy tips
  lines.push("## Exploration Strategy");
  lines.push("- Start by navigating to the main page");
  lines.push("- Identify key interactive elements (buttons, links, forms)");
  lines.push("- Fill in form fields with realistic test data");
  lines.push("- Wait for page transitions after actions");
  lines.push("- After opening recommendations, AI analysis, WHOIS, details, or report panels, wait or scroll so the newly rendered content is visible before moving on");
  lines.push("- If the goal asks you to complete a modal or dialog action, do not stop after opening the modal; use the modal's visible action selectors to submit, approve, send, or confirm it");
  lines.push("- Add narration at key moments to explain what's happening");
  lines.push("- End with the `done` action when the demo is complete");
  lines.push("- Focus on the user-facing features that showcase the product");

  return lines.join("\n");
}

// ─── Page State Serializer ───────────────────────────────────────────────────

/**
 * Serializes the current browser page state into a structured format
 * suitable for LLM context.
 */
/** Raw interactive element data collected in the page context. */
interface InteractiveElement {
  tag: string;
  id: string;
  type: string;
  role: string;
  name: string;
  text: string;
  value: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  options?: string[];
}

/** Map a tag/type to its implicit ARIA role for role= selectors. */
function implicitRole(el: InteractiveElement): string {
  if (el.role) return el.role;
  switch (el.tag) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "input":
      if (el.type === "checkbox") return "checkbox";
      if (el.type === "radio") return "radio";
      if (el.type === "button" || el.type === "submit") return "button";
      return "textbox";
    default:
      return "";
  }
}

/** Derive the most reliable selector for an element: #id first, then role=. */
function deriveSelector(el: InteractiveElement): string | null {
  if (el.id) return `#${el.id}`;
  const role = implicitRole(el);
  if (role && el.name) {
    const escaped = el.name.replace(/"/g, '\\"');
    return `role=${role}[name="${escaped}" i]`;
  }
  if (role) return `role=${role}`;
  return null;
}

async function serializePageState(
  browser: BrowserSession,
  _config: ExplorerConfig
): Promise<PageState> {
  const browserState = await browser.getState();

  const axTree: AccessibilityNode[] = [];
  const selectors: string[] = [];
  const formFields: FormField[] = [];
  let openDialogs: OpenDialog[] = [];
  let visibleText = "";

  try {
    const page = browser.page;
    if (page) {
      // Scan the live DOM for visible interactive elements. This yields
      // selectors that actually resolve (unlike the deprecated accessibility
      // snapshot, which carries no DOM identity).
      const elements: InteractiveElement[] = await (page as any).evaluate(() => {
        const out: unknown[] = [];
        const nodes = document.querySelectorAll(
          'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
        );
        for (const el of Array.from(nodes)) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const tag = el.tagName.toLowerCase();
          const input = el as HTMLInputElement;
          const labelText =
            el.getAttribute("aria-label") ||
            (input.labels && input.labels[0]?.textContent?.trim()) ||
            "";
          const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
          out.push({
            tag,
            id: el.id || "",
            type: el.getAttribute("type") || "",
            role: el.getAttribute("role") || "",
            name: labelText || text,
            text,
            value: "value" in el ? String(input.value).slice(0, 40) : "",
            placeholder: el.getAttribute("placeholder") || "",
            required: input.required === true,
            disabled:
              input.disabled === true ||
              el.getAttribute("aria-disabled") === "true",
            options:
              tag === "select"
                ? Array.from((el as HTMLSelectElement).options)
                    .map((o) => o.value)
                    .slice(0, 20)
                : undefined,
          });
          if (out.length >= 80) break;
        }
        return out;
      });

      visibleText = await (page as any).evaluate(() => {
        return document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 4000);
      });

      openDialogs = await (page as any).evaluate(() => {
        const isVisible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          const rect = (el as HTMLElement).getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const selectorFor = (el: Element): string | null => {
          if ((el as HTMLElement).id) return `#${(el as HTMLElement).id}`;
          const role =
            el.getAttribute("role") ||
            (el.tagName.toLowerCase() === "button" ? "button" : "");
          const name =
            el.getAttribute("aria-label") ||
            (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
          if (role && name) return `role=${role}[name="${name.replace(/"/g, '\\"')}" i]`;
          return null;
        };

        const modalNodes = Array.from(
          document.querySelectorAll(
            'dialog[open], [role="dialog"], [aria-modal="true"], .modal.is-open, .modal-backdrop.is-open, [data-modal-open="true"]'
          )
        ).filter(isVisible);

        return modalNodes.slice(0, 3).map((dialog) => {
          const title =
            dialog.querySelector("h1,h2,h3,[id$='title'],[data-dialog-title]")?.textContent
              ?.trim()
              .replace(/\s+/g, " ") || undefined;
          const actions = Array.from(
            dialog.querySelectorAll("button, a[href], input[type='button'], input[type='submit'], [role='button']")
          )
            .filter(isVisible)
            .map((el) => ({
              name:
                el.getAttribute("aria-label") ||
                (el.textContent || (el as HTMLInputElement).value || "")
                  .trim()
                  .replace(/\s+/g, " "),
              selector: selectorFor(el),
            }))
            .filter((action): action is { name: string; selector: string | null } => Boolean(action.name));

          return {
            title,
            text: (dialog as HTMLElement).innerText.replace(/\n{3,}/g, "\n\n").slice(0, 1800),
            actions: actions.map((action) => action.name).slice(0, 20),
            selectors: actions
              .map((action) => action.selector)
              .filter((selector): selector is string => Boolean(selector))
              .slice(0, 20),
          };
        });
      });

      for (const el of elements) {
        const selector = deriveSelector(el);
        const role = implicitRole(el);
        const optionsSuffix = el.options ? ` options: [${el.options.join(", ")}]` : "";
        const disabledSuffix = el.disabled ? " disabled" : "";
        axTree.push({
          role,
          name: el.name || el.placeholder,
          tag: el.tag,
          value: [el.value, optionsSuffix.trim(), disabledSuffix.trim()].filter(Boolean).join(" "),
          interactive: true,
          depth: 0,
          selector: selector ?? undefined,
        });
        if (selector && !selectors.includes(selector)) {
          selectors.push(selector);
        }
        const isFormField =
          el.tag === "input" || el.tag === "select" || el.tag === "textarea";
        if (isFormField && selector) {
          formFields.push({
            selector,
            name: el.name || el.id,
            type: el.tag === "select" ? "select" : el.type || "text",
            value: el.options ? `${el.value}${optionsSuffix}` : el.value,
            placeholder: el.placeholder || undefined,
            required: el.required,
          });
        }
      }
    }
  } catch {
    // Fallback: build a minimal page state without element data
  }

  return {
    url: browserState.url,
    title: browserState.title,
    viewport: browserState.viewport,
    axTree,
    selectors,
    formFields,
    openDialogs: openDialogs.length > 0 ? openDialogs : undefined,
    visibleText: visibleText || undefined,
  };
}

// ─── LLM Request Builder ─────────────────────────────────────────────────────

/**
 * Builds the conversation messages for an LLM request.
 */
function buildLlmMessages(
  systemPrompt: string,
  pageState: PageState,
  history: Array<{ role: "assistant"; content: string }>
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const userMessages: string[] = [];

  userMessages.push("## Current Page State");
  userMessages.push(`URL: ${pageState.url}`);
  userMessages.push(`Title: ${pageState.title}`);
  userMessages.push(`Viewport: ${pageState.viewport.width}x${pageState.viewport.height}`);
  userMessages.push("");

  if (pageState.axTree.length > 0) {
    userMessages.push("## Interactive Elements (selector in [brackets] — use it verbatim)");
    for (const node of pageState.axTree) {
      const indent = "  ".repeat(node.depth);
      const selector = node.selector ? ` [${node.selector}]` : "";
      const value = node.value ? ` (value: "${node.value}")` : "";
      userMessages.push(`${indent}- ${node.tag || "?"} [${node.role}]${selector}: "${node.name}"${value}`);
    }
    userMessages.push("");
  }

  if (pageState.visibleText) {
    userMessages.push("## Visible Page Text (truncated)");
    userMessages.push(pageState.visibleText);
    userMessages.push("");
  }

  if (pageState.openDialogs && pageState.openDialogs.length > 0) {
    userMessages.push("## Open Dialogs / Modals");
    for (const dialog of pageState.openDialogs) {
      userMessages.push(`- ${dialog.title || "Dialog"}: ${dialog.text}`);
      if (dialog.actions.length > 0) {
        userMessages.push(`  Actions: ${dialog.actions.join(", ")}`);
      }
      if (dialog.selectors.length > 0) {
        userMessages.push(`  Action selectors: ${dialog.selectors.join(", ")}`);
      }
    }
    userMessages.push("Do not return `done` while a dialog still contains actions needed by the goal.");
    userMessages.push("");
  }

  if (pageState.formFields.length > 0) {
    userMessages.push("## Form Fields");
    for (const field of pageState.formFields) {
      userMessages.push(
        `- ${field.selector}: type="${field.type}", name="${field.name}", value="${field.value}"${field.required ? " (required)" : ""}`
      );
    }
    userMessages.push("");
  }

  userMessages.push("## Available Selectors");
  for (const sel of pageState.selectors.slice(0, 20)) {
    userMessages.push(`- ${sel}`);
  }
  userMessages.push("");

  if (history.length > 0) {
    userMessages.push("## Previous Actions");
    for (const h of history) {
      userMessages.push(`- ${h.content}`);
    }
    userMessages.push("");
  }

  userMessages.push("What action should I take next?");

  return [
    { role: "system" as const, content: systemPrompt },
    ...history.map((h) => ({ role: "assistant" as const, content: h.content })),
    { role: "user" as const, content: userMessages.join("\n") },
  ];
}

// ─── Action Executor ─────────────────────────────────────────────────────────

function narrationText(action: LlmActionResponse): string {
  const params = action.params as Record<string, unknown> | undefined;
  for (const value of [
    action.narration,
    params?.narration,
    params?.text,
    params?.content,
    params?.value,
  ]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function actionText(action: LlmActionResponse): string {
  const params = action.params as Record<string, unknown> | undefined;
  return [
    params?.selector,
    params?.text,
    params?.value,
    action.notes,
    action.narration,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

type ClickObservationKind = "content" | "dialog-open" | "dialog-submit";

function clickObservationKind(action: LlmActionResponse): ClickObservationKind | null {
  if (action.action !== "click") return null;
  const text = actionText(action);
  if (/\b(send|submit|confirm)\b|submit\b|#.*submit/i.test(text)) {
    return "dialog-submit";
  }
  if (/\b(report|modal|dialog|approve|block \+ report|apply \+ report)\b/i.test(text)) {
    return "dialog-open";
  }
  if (/\b(recommendation|whois|analysis|inspect|logs?|details?|open|show|expand)\b/i.test(text)) {
    return "content";
  }
  return null;
}

function goalNeedsDialogCompletion(goal: string): boolean {
  return (
    /\b(modal|dialog|report|abuse|send|submit|approve|confirm|block|apply)\b/i.test(goal) &&
    /\b(send|submit|approve|confirm|report|block|apply)\b/i.test(goal)
  );
}

function prematureDoneReason(goal: string, pageState: PageState): string | null {
  if (!goalNeedsDialogCompletion(goal)) return null;
  const dialog = pageState.openDialogs?.[0];
  if (!dialog) return null;

  const actionSummary = dialog.actions.length > 0
    ? ` Available modal actions: ${dialog.actions.join(", ")}.`
    : "";
  return `modal/dialog is still open${dialog.title ? ` (${dialog.title})` : ""}; complete the requested modal action before done.${actionSummary}`;
}

async function settleAfterClick(
  browser: BrowserSession,
  action: LlmActionResponse
): Promise<string | undefined> {
  const kind = clickObservationKind(action);
  const page = browser.page as any;
  if (!kind || !page) return undefined;

  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(350).catch(() => {});
  }

  if (typeof page.waitForFunction === "function") {
    await page.waitForFunction(
      (expectedKind: ClickObservationKind) => {
        const isVisible = (el: Element): boolean => {
          const style = window.getComputedStyle(el);
          const rect = (el as HTMLElement).getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const openDialog = Array.from(
          document.querySelectorAll(
            'dialog[open], [role="dialog"], [aria-modal="true"], .modal.is-open, .modal-backdrop.is-open, [data-modal-open="true"]'
          )
        ).find(isVisible);
        const visibleLoaders = Array.from(
          document.querySelectorAll(".loading, .compact-loading, .loading-inline, [aria-busy='true']")
        ).filter(isVisible);

        if (expectedKind === "dialog-open" || expectedKind === "dialog-submit") {
          if (!openDialog) {
            return expectedKind === "dialog-submit" && visibleLoaders.length === 0;
          }
          const text = (openDialog as HTMLElement).innerText.toLowerCase();
          if (/\bsending\b|\bloading\b/.test(text)) return false;
          const readyAction = Array.from(
            openDialog.querySelectorAll("button, input[type='button'], input[type='submit'], [role='button']")
          )
            .filter(isVisible)
            .some((el) => {
              const button = el as HTMLButtonElement;
              const label = (
                el.getAttribute("aria-label") ||
                el.textContent ||
                (el as HTMLInputElement).value ||
                ""
              ).trim();
              return (
                !button.disabled &&
                el.getAttribute("aria-disabled") !== "true" &&
                /\b(send|submit|report|approve|confirm|again)\b/i.test(label)
              );
            });
          return readyAction || visibleLoaders.length === 0;
        }

        return visibleLoaders.length === 0;
      },
      kind,
      { timeout: kind === "content" ? 6000 : 8000 }
    ).catch(() => {});
  }

  const scrolled = typeof page.evaluate === "function" ? await page.evaluate((label: string) => {
    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el);
      const rect = (el as HTMLElement).getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const lower = label.toLowerCase();
    const candidateSelectors: string[] = [
      'dialog[open]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      ".modal-backdrop.is-open .modal-dialog",
    ];
    if (lower.includes("whois")) {
      candidateSelectors.push("[id^='whois-']", ".whois-panel", ".whois-abuse");
    }
    if (lower.includes("recommendation")) {
      candidateSelectors.push("[id^='recommendation-']", ".recommendation");
    }
    if (lower.includes("inspect") || lower.includes("analysis") || lower.includes("log")) {
      candidateSelectors.push("[id^='ai-inspect-']", ".ai-inspect-panel", ".ai-inspect-text");
    }

    const candidates = candidateSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(isVisible);
    const target = candidates[candidates.length - 1] as HTMLElement | undefined;
    if (!target) return "";
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    return target.id || String(target.className || "") || target.tagName.toLowerCase();
  }, actionText(action)).catch(() => "") : "";

  if (typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(kind === "content" ? 1200 : 900).catch(() => {});
  }
  const label = kind === "content" ? "content" : "dialog";
  return scrolled ? `; paused on ${label} content` : `; paused for ${label} content`;
}

/**
 * Executes an action on the browser based on the LLM response.
 * Returns a result string describing what happened.
 *
 * Browser action calls commonly fail (e.g. selector not found); failures are
 * returned as an error result so the exploration loop records them and continues.
 */
async function executeAction(
  browser: BrowserSession,
  action: LlmActionResponse
): Promise<{ result: string; error?: string }> {
  try {
    return await executeActionUnsafe(browser, action);
  } catch (err) {
    return {
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeActionUnsafe(
  browser: BrowserSession,
  action: LlmActionResponse
): Promise<{ result: string; error?: string }> {
  const params = action.params as Record<string, unknown> | undefined;

  switch (action.action) {
    case "goto": {
      const url = params?.url as string;
      if (!url) {
        return { result: "skipped", error: "goto requires url parameter" };
      }
      await browser.goto(url);
      return { result: `navigated to ${url}` };
    }

    case "click": {
      const selector = params?.selector as string;
      if (!selector) {
        return { result: "skipped", error: "click requires selector parameter" };
      }
      await browser.click(selector);
      const observation = await settleAfterClick(browser, action);
      return { result: `clicked ${selector}${observation ?? ""}` };
    }

    case "hover": {
      const selector = params?.selector as string;
      if (!selector) {
        return { result: "skipped", error: "hover requires selector parameter" };
      }
      await browser.hover(selector);
      return { result: `hovered ${selector}` };
    }

    case "fill": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) {
        return { result: "skipped", error: "fill requires selector and value parameters" };
      }
      await browser.fill(selector, value);
      return { result: `filled ${selector} with "${value}"` };
    }

    case "select": {
      const selector = params?.selector as string;
      const value = params?.value as string;
      if (!selector || !value) {
        return { result: "skipped", error: "select requires selector and value parameters" };
      }
      await browser.select(selector, value);
      return { result: `selected "${value}" in ${selector}` };
    }

    case "press": {
      const key = params?.key as string;
      if (!key) {
        return { result: "skipped", error: "press requires key parameter" };
      }
      await browser.press(key);
      return { result: `pressed ${key}` };
    }

    case "scroll": {
      const amount = params?.amount as number;
      if (amount === undefined) {
        return { result: "skipped", error: "scroll requires amount parameter" };
      }
      await browser.scroll({ deltaY: amount });
      return { result: `scrolled by ${amount}` };
    }

    case "wait_for": {
      const text = params?.text as string;
      const selector = params?.selector as string;
      if (text) {
        await browser.wait_for({ text });
        return { result: `waited for text "${text}"` };
      } else if (selector) {
        await browser.wait_for({ selector });
        return { result: `waited for selector ${selector}` };
      }
      return { result: "skipped", error: "wait_for requires text or selector parameter" };
    }

    case "narrate": {
      const narration = narrationText(action);
      if (!narration) {
        return { result: "skipped", error: "narrate requires narration text" };
      }
      return { result: `narration: "${narration}"` };
    }

    case "screenshot": {
      const buf = await browser.screenshot();
      return { result: `screenshot taken (${buf.length} bytes)` };
    }

    case "mark_flow_start": {
      const name = params?.name as string;
      if (!name) {
        return { result: "skipped", error: "mark_flow_start requires name parameter" };
      }
      return { result: `flow started: ${name}` };
    }

    case "mark_flow_end": {
      const name = params?.name as string;
      if (!name) {
        return { result: "skipped", error: "mark_flow_end requires name parameter" };
      }
      return { result: `flow ended: ${name}` };
    }

    case "done": {
      return { result: "exploration done" };
    }

    case "pause": {
      const duration = params?.duration as number;
      if (duration === undefined) {
        return { result: "skipped", error: "pause requires duration parameter" };
      }
      await new Promise((resolve) => setTimeout(resolve, duration));
      return { result: `paused for ${duration}ms` };
    }

    default: {
      return { result: "skipped", error: `unknown action type: ${action.action}` };
    }
  }
}

// ─── ExplorerAgent ───────────────────────────────────────────────────────────

/**
 * Main exploration agent class.
 *
 * Drives the browser, calls the LLM for action selection, executes actions,
 * and builds a demo script from the exploration transcript.
 */
export class ExplorerAgent {
  private config: ExplorerConfig;
  private transcript: ExplorationTranscript;
  private guardrails: Guardrails;
  private llmHistory: Array<{ role: "assistant"; content: string }> = [];
  private actionCount = 0;
  private startTime = 0;

  constructor(config: ExplorerConfig) {
    this.config = config;
    this.guardrails = new Guardrails({
      allowedOrigins: config.guardrails?.allowedOrigins,
      destructiveButtonPatterns: config.guardrails?.destructiveButtonPatterns,
      destructiveUrlPatterns: config.guardrails?.destructiveUrlPatterns,
      maxSteps: config.maxSteps,
      maxTime: config.maxTime,
    });
    this.transcript = {
      url: config.url,
      goal: config.goal,
      turns: [],
      totalTurns: 0,
      blockedTurns: 0,
      elapsed: 0,
      completed: false,
      stopReason: undefined,
    };
  }

  /**
   * Run the exploration loop.
   * Each turn: serialize page state -> call LLM -> parse response ->
   * execute action -> record step -> repeat until done or budget exhausted.
   */
  async run(): Promise<ExplorationResult> {
    this.startTime = Date.now();
    const browser = this.config.browser;

    // Launch browser
    await browser.launch();

    try {
      const systemPrompt = buildSystemPrompt(this.config);
      const actionSchema = buildActionSchema();

      // Navigate to starting URL
      await browser.goto(this.config.url);

      // Total turn budget: blocked/invalid/errored turns don't count toward
      // maxSteps, so cap total turns to avoid an unbounded loop against a
      // misbehaving LLM.
      const maxTurns = this.config.maxSteps * 3;

      // Main exploration loop
      while (this.actionCount < this.config.maxSteps) {
        // Check turn budget
        if (this.transcript.totalTurns >= maxTurns) {
          this.report({
            type: "budget_exceeded",
            message: `Turn budget exhausted: ${this.transcript.totalTurns} turns (max ${maxTurns}) with only ${this.actionCount} productive actions`,
          });
          this.transcript.stopReason = "max_turns";
          break;
        }

        // Check time budget
        const timeStatus = this.guardrails.checkTimeBudget();
        if (timeStatus.exceeded) {
          this.report({ type: "budget_exceeded", message: timeStatus.message });
          this.transcript.stopReason = "max_time";
          const partial = this.guardrails.emitPartialScript("max_time");
          this.transcript.assembly = {
            script: partial.steps.length > 0 ? {
              demo: this.config.goal,
              title: this.config.scriptTemplate.title,
              viewport: { width: this.config.viewport.width, height: this.config.viewport.height, scale: 1 },
              narration_mode: this.config.scriptTemplate.narration_mode,
              steps: partial.steps,
            } : { demo: this.config.goal, title: this.config.scriptTemplate.title, viewport: { width: this.config.viewport.width, height: this.config.viewport.height, scale: 1 }, narration_mode: this.config.scriptTemplate.narration_mode, steps: [{ done: true }] },
            valid: true,
          };
          break;
        }

        // Check step budget
        const stepStatus = this.guardrails.checkStepBudget();
        if (stepStatus.warning) {
          this.report({ type: "budget_warning", message: stepStatus.message });
        }

        // Serialize page state
        const pageState = await serializePageState(browser, this.config);

        // Build LLM messages
        const messages = buildLlmMessages(systemPrompt, pageState, this.llmHistory);

        // Record turn start
        const turnNumber = this.transcript.totalTurns + 1;
        const turnStart = new Date().toISOString();
        this.report({ type: "turn_start", turn: turnNumber, steps: this.actionCount });

        // Call LLM
        let llmResponse: LlmActionResponse;
        let turnError: string | undefined;

        try {
          llmResponse = await this.config.llmClient.sendAction(
            systemPrompt,
            messages,
            actionSchema
          );
        } catch (error) {
          turnError = error instanceof Error ? error.message : "Unknown LLM error";
          this.report({
            type: "turn_end",
            turn: turnNumber,
            steps: this.actionCount,
            message: `LLM error: ${turnError}`,
          });

          // Record the failed turn
          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            blocked: true,
            blockReason: `LLM error: ${turnError}`,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;

          // Stop on LLM error
          this.transcript.stopReason = "error";
          break;
        }

        // Validate action type
        if (!VALID_ACTIONS.has(llmResponse.action)) {
          const blockReason = `invalid action type: "${llmResponse.action}" is not in the allowed action space`;
          this.report({
            type: "action_blocked",
            turn: turnNumber,
            action: llmResponse.action,
            blocked: true,
            blockReason,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            blocked: true,
            blockReason,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;
          continue;
        }

        // Check guardrails
        const guardrailBlockReason = this.guardrails.checkAction(llmResponse).reason;

        if (guardrailBlockReason) {
          this.report({
            type: "action_blocked",
            turn: turnNumber,
            action: llmResponse.action,
            actionParams: llmResponse.params,
            blocked: true,
            blockReason: guardrailBlockReason,
          });

          this.guardrails.addTranscriptEntry({
            turn: turnNumber,
            action: llmResponse.action,
            params: llmResponse.params,
            blocked: true,
            blockReason: guardrailBlockReason,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            blocked: true,
            blockReason: guardrailBlockReason,
          });
          this.transcript.totalTurns++;
          this.transcript.blockedTurns++;
          continue;
        }

        if (llmResponse.action === "done") {
          const doneBlockReason = prematureDoneReason(this.config.goal, pageState);
          if (doneBlockReason) {
            this.report({
              type: "action_blocked",
              turn: turnNumber,
              action: llmResponse.action,
              actionParams: llmResponse.params,
              blocked: true,
              blockReason: doneBlockReason,
            });

            this.guardrails.addTranscriptEntry({
              turn: turnNumber,
              action: llmResponse.action,
              params: llmResponse.params,
              blocked: true,
              blockReason: doneBlockReason,
            });

            this.llmHistory.push({
              role: "assistant",
              content: `done blocked: ${doneBlockReason}`,
            });

            this.transcript.turns.push({
              turn: turnNumber,
              startTime: turnStart,
              pageState,
              systemPrompt,
              llmRequest: messages,
              llmResponse,
              selectedAction: llmResponse,
              blocked: true,
              blockReason: doneBlockReason,
            });
            this.transcript.totalTurns++;
            this.transcript.blockedTurns++;
            continue;
          }
        }

        // Execute action
        const { result, error } = await executeAction(browser, llmResponse);

        if (error) {
          this.report({
            type: "turn_end",
            turn: turnNumber,
            steps: this.actionCount,
            message: `Action error: ${error}`,
          });

          this.transcript.turns.push({
            turn: turnNumber,
            startTime: turnStart,
            endTime: new Date().toISOString(),
            pageState,
            systemPrompt,
            llmRequest: messages,
            llmResponse,
            selectedAction: llmResponse,
            executedAction: llmResponse,
            blocked: false,
            actionResult: `error: ${error}`,
            error,
          });
          this.transcript.totalTurns++;
          continue;
        }

        // Record successful action
        this.actionCount++;
        this.guardrails.recordStep();
        const narration = llmResponse.action === "narrate" ? narrationText(llmResponse) : "";
        const entryParams = llmResponse.action === "narrate" && narration
          ? { ...llmResponse.params, narration }
          : llmResponse.params;
        this.guardrails.addTranscriptEntry({
          turn: turnNumber,
          action: llmResponse.action,
          params: entryParams,
          result,
          blocked: false,
        });
        this.report({
          type: "action_executed",
          turn: turnNumber,
          action: llmResponse.action,
          actionParams: llmResponse.params,
          message: result,
        });

        this.llmHistory.push({
          role: "assistant",
          content: `${llmResponse.action}: ${result}${llmResponse.notes ? " (" + llmResponse.notes + ")" : ""}`,
        });

        this.transcript.turns.push({
          turn: turnNumber,
          startTime: turnStart,
          endTime: new Date().toISOString(),
          pageState,
          systemPrompt,
          llmRequest: messages,
          llmResponse,
          selectedAction: llmResponse,
          executedAction: llmResponse,
          blocked: false,
          actionResult: result,
        });

        this.transcript.totalTurns++;

        this.report({
          type: "turn_end",
          turn: turnNumber,
          steps: this.actionCount,
          message: result,
        });

        // Check if done
        if (llmResponse.action === "done") {
          this.transcript.stopReason = "done";
          this.transcript.completed = true;
          break;
        }
      }

      // Step budget check
      if (!this.transcript.stopReason) {
        const stepStatus = this.guardrails.checkStepBudget();
        if (stepStatus.exceeded) {
          this.report({
            type: "budget_exceeded",
            message: stepStatus.message,
          });
          this.transcript.stopReason = "max_steps";
          const partial = this.guardrails.emitPartialScript("max_steps");
          this.transcript.assembly = {
            script: partial.steps.length > 0 ? {
              demo: this.config.goal,
              title: this.config.scriptTemplate.title,
              viewport: { width: this.config.viewport.width, height: this.config.viewport.height, scale: 1 },
              narration_mode: this.config.scriptTemplate.narration_mode,
              steps: partial.steps,
            } : { demo: this.config.goal, title: this.config.scriptTemplate.title, viewport: { width: this.config.viewport.width, height: this.config.viewport.height, scale: 1 }, narration_mode: this.config.scriptTemplate.narration_mode, steps: [{ done: true }] },
            valid: true,
          };
        }
      }

      // Assemble script
      const assembly = this.guardrails.assembleScript(
        this.config.scriptTemplate.title,
        this.config.scriptTemplate.narration_mode,
        { url: this.config.url, viewport: this.config.viewport }
      );
      this.transcript.assembly = {
        script: assembly.script,
        valid: assembly.valid,
        errors: assembly.errors,
      };

      this.report({
        type: "script_assembled",
        steps: assembly.script.steps.length,
        message: `Assembled ${assembly.script.steps.length} steps${assembly.errors ? ` (${assembly.errors.length} validation errors)` : ""}`,
      });

      // Human confirmation step
      let confirmed = false;
      if (this.config.requireConfirmation && this.config.confirmDiscovery) {
        const proposedFlows = this.proposeFlows();
        this.report({
          type: "human_confirm_requested",
          flows: proposedFlows,
          message: `Proposed ${proposedFlows.length} flow(s) for confirmation`,
        });

        const selectedFlows = await this.config.confirmDiscovery(proposedFlows);
        confirmed = selectedFlows.length > 0;

        this.report({
          type: "human_confirm_received",
          confirmed,
          message: confirmed ? "User confirmed the proposed flows" : "User declined all flows",
        });

        if (!confirmed) {
          this.transcript.stopReason = "declined";
        }
      }

      this.transcript.elapsed = Date.now() - this.startTime;

      this.report({
        type: "exploration_complete",
        steps: this.actionCount,
        message: `Exploration complete: ${this.actionCount} actions, ${this.transcript.blockedTurns} blocked`,
      });

      return {
        success: this.transcript.stopReason === "done" && !assembly.errors,
        script: assembly.script,
        transcript: this.transcript,
        confirmed,
        stopReason: this.transcript.stopReason || "unknown",
      };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  /**
   * Propose flows from the exploration transcript for human confirmation.
   */
  private proposeFlows(): string[] {
    const flows: string[] = [];
    let currentFlow: string[] = [];

    for (const turn of this.transcript.turns) {
      if (turn.blocked) continue;

      const action = turn.selectedAction;
      if (!action) continue;

      if (action.action === "mark_flow_start") {
        if (currentFlow.length > 0) {
          flows.push(currentFlow.join(" -> "));
        }
        currentFlow = [action.params?.name as string || "untitled"];
      } else if (action.action === "mark_flow_end") {
        currentFlow.push(action.params?.name as string || "end");
        flows.push(currentFlow.join(" -> "));
        currentFlow = [];
      } else if (action.action === "goto") {
        const url = action.params?.url as string;
        if (url) {
          let label: string;
          try {
            label = new URL(url).hostname.replace("www.", "");
          } catch {
            // Malformed or relative URL — fall back to the raw string
            label = url;
          }
          currentFlow.push(label);
        }
      } else if (action.action === "done") {
        if (currentFlow.length > 0) {
          flows.push(currentFlow.join(" -> "));
        }
      } else {
        const actionLabel = `${action.action}(${Object.keys(action.params || {}).join(", ")})`;
        if (currentFlow.length === 0) {
          currentFlow.push(actionLabel);
        } else {
          currentFlow.push(actionLabel);
        }
      }
    }

    if (currentFlow.length > 0 && flows.length === 0) {
      flows.push(currentFlow.join(" -> "));
    }

    if (flows.length === 0) {
      flows.push("Main exploration flow");
    }

    return flows;
  }

  /**
   * Report a progress event to the progress reporter.
   */
  private report(event: ProgressEvent): void {
    event.elapsed = event.elapsed ?? (Date.now() - this.startTime);
    event.steps = event.steps ?? this.actionCount;
    event.maxSteps = event.maxSteps ?? this.config.maxSteps;
    event.maxTime = event.maxTime ?? this.config.maxTime;
    this.config.reporter.report(event);
  }
}
