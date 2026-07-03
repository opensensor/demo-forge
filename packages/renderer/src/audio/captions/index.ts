/**
 * DemoForge renderer — caption module.
 */

export { CaptionGenerator } from './generator.js';
export { BurnedInCaptions } from './burned-in.js';
export { SidecarCaptionWriter } from './sidecar-writer.js';

export type {
  CaptionStyle,
  DefaultCaptionStyle,
  CaptionEntry,
  BurnedInCaptionOptions,
  CaptionGenerationResult,
  CaptionFormat,
  SubtitleFilterOutput,
} from './types.js';
