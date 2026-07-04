/**
 * Zod schemas for Demo Script validation.
 *
 * These schemas enforce the structure and constraints of a Demo Script
 * including action type validation, viewport dimensions, and narration modes.
 */

import { z } from "zod";

/** Supported effects. */
export const effectSchema = z.enum(["highlight", "zoom", "dim", "callout"]);

/** Supported narration modes. */
export const narrationModeSchema = z.enum(["captions", "tts", "none"]);

/** Supported typing styles. */
export const typingStyleSchema = z.enum(["natural", "instant"]);

/** Supported settle policies. */
export const settlePolicySchema = z.enum(["networkidle", "domcontentloaded", "load"]);

/** Supported annotation targets. */
export const annotationTargetSchema = z.enum(["target", "viewport", "all"]);

/** Supported wait states. */
export const waitForStateSchema = z.enum(["visible", "hidden", "attached", "detached"]);

/** Viewport scale factor. */
export const scaleFactorSchema = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(1.5),
  z.literal(2),
  z.literal(2.5),
  z.literal(3),
  z.literal(3.5),
  z.literal(4),
]);

/** Viewport definition. */
export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scale: scaleFactorSchema,
});

/** Selector: role+name variant. */
const roleSelectorSchema = z.object({
  role: z.string(),
  name: z.string().optional(),
});

/** Selector: label variant. */
const labelSelectorSchema = z.object({
  label: z.string(),
});

/** Selector: text variant. */
const textSelectorSchema = z.object({
  text: z.string(),
});

/** Selector: CSS variant. */
const cssSelectorSchema = z.object({
  css: z.string(),
});

/** Selector: XPath variant. */
const xpathSelectorSchema = z.object({
  xpath: z.string(),
});

/** Selector: plain string variant. */
const stringSelectorSchema = z.string();

/** All selector variants. */
export const selectorSchema = z.union([
  roleSelectorSchema,
  labelSelectorSchema,
  textSelectorSchema,
  cssSelectorSchema,
  xpathSelectorSchema,
  stringSelectorSchema,
]);

/** Wait-for text condition. */
export const waitForTextConditionSchema = z.object({
  text: z.string(),
  timeout: z.number().optional(),
});

/** Wait-for selector condition. */
export const waitForSelectorConditionSchema = z.object({
  selector: selectorSchema,
  state: waitForStateSchema.optional(),
  timeout: z.number().optional(),
});

export const waitForConditionSchema = z.union([
  waitForTextConditionSchema,
  waitForSelectorConditionSchema,
]);

/** Fill config. */
export const fillConfigSchema = z.object({
  target: selectorSchema,
  value: z.string(),
  typing: typingStyleSchema.optional(),
});

/** Select config. */
export const selectConfigSchema = z.object({
  target: selectorSchema,
  value: z.string(),
});

/** Screenshot config. */
export const screenshotConfigSchema = z.object({
  name: z.string().optional(),
  annotate: z.array(annotationTargetSchema).optional(),
});

/** Scroll config. */
export const scrollConfigSchema = z.object({
  amount: z.number(),
});

/** Press config. */
export const pressConfigSchema = z.object({
  key: z.string(),
});

/** Flow marker. */
export const flowMarkerSchema = z.object({
  name: z.string(),
});

/** Navigation step. */
export const gotoStepSchema = z.object({
  goto: z.string(),
  settle: settlePolicySchema.optional(),
}).strict();

/** Click step. */
export const clickStepSchema = z.object({
  click: selectorSchema,
  effect: effectSchema.optional(),
}).strict();

/** Hover step. */
export const hoverStepSchema = z.object({
  hover: selectorSchema,
  effect: effectSchema.optional(),
}).strict();

/** Fill step. */
export const fillStepSchema = z.object({
  fill: fillConfigSchema,
  effect: effectSchema.optional(),
}).strict();

/** Select step. */
export const selectStepSchema = z.object({
  select: selectConfigSchema,
  effect: effectSchema.optional(),
}).strict();

/** Press step. */
export const pressStepSchema = z.object({
  press: pressConfigSchema,
  effect: effectSchema.optional(),
}).strict();

/** Scroll step. */
export const scrollStepSchema = z.object({
  scroll: scrollConfigSchema,
  effect: effectSchema.optional(),
}).strict();

/** Wait-for step. */
export const waitForStepSchema = z.object({
  wait_for: waitForConditionSchema,
  effect: effectSchema.optional(),
}).strict();

/** Narrate step. */
export const narrateStepSchema = z.object({
  narrate: z.string(),
}).strict();

/** Screenshot step. */
export const screenshotStepSchema = z.object({
  screenshot: screenshotConfigSchema,
}).strict();

/** Mark flow start step. */
export const markFlowStartStepSchema = z.object({
  mark_flow_start: flowMarkerSchema,
}).strict();

/** Mark flow end step. */
export const markFlowEndStepSchema = z.object({
  mark_flow_end: flowMarkerSchema,
}).strict();

/** Done step. */
export const doneStepSchema = z.object({
  done: z.literal(true),
}).strict();

/** Pause step. */
export const pauseStepSchema = z.object({
  pause: z.number().positive(),
}).strict();

/**
 * Union of all step schemas.
 * Each variant is strict so extra keys are rejected.
 */
export const demoStepSchema = z.union([
  gotoStepSchema,
  clickStepSchema,
  hoverStepSchema,
  fillStepSchema,
  selectStepSchema,
  pressStepSchema,
  scrollStepSchema,
  waitForStepSchema,
  narrateStepSchema,
  screenshotStepSchema,
  markFlowStartStepSchema,
  markFlowEndStepSchema,
  doneStepSchema,
  pauseStepSchema,
]);

/** Viewport config for render matrix. */
const viewportConfigSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** Render matrix. */
export const renderMatrixSchema = z.object({
  viewports: z.array(viewportConfigSchema).min(1),
  themes: z.array(z.enum(["light", "dark"])).optional(),
  locales: z.array(z.string()).optional(),
});

/**
 * Top-level Demo Script schema.
 */
export const demoScriptSchema = z.object({
  demo: z.string().min(1),
  title: z.string().min(1),
  url: z.string().optional(),
  viewport: viewportSchema,
  narration_mode: narrationModeSchema,
  steps: z.array(demoStepSchema).min(0),
  render_matrix: renderMatrixSchema.optional(),
});

/**
 * Validation result type.
 */
export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  error: z.ZodError;
}

export type ValidationResultOrFailure<T> = ValidationResult<T> | ValidationFailure;

/**
 * Validate a Demo Script object against the schema.
 *
 * @param script - The script object to validate
 * @returns A result indicating success or failure with error details
 */
export function validateDemoScript(script: unknown): ValidationResultOrFailure<Record<string, unknown>> {
  const result = demoScriptSchema.safeParse(script);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
