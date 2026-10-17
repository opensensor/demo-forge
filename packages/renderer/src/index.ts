/**
 * DemoForge renderer package — replay engine and video capture.
 */

export { Renderer, RenderError, redactionScript } from './replay/renderer.js';
export { stabilityDetect, type StabilityResult } from './replay/stability.js';
export { detectCSP, type CSPResult } from './replay/csp.js';
export { accessibilityDiff } from './replay/accessibility.js';
export { VirtualTimeController } from './virtual-time/controller.js';
export type { VirtualTimeConfig } from './virtual-time/controller.js';
export type {
  RenderConfig,
  RenderResult,
  StepAction,
  StepFailure,
  StepResult,
  StepResultSuccess,
  StepResultFailure,
  StepResultTimeout,
  StepResultTiming,
  GotoAction,
  ClickAction,
  HoverAction,
  FillAction,
  SelectAction,
  PressAction,
  WaitForAction,
  NarrateAction,
  ScreenshotAction,
  MarkFlowStartAction,
  MarkFlowEndAction,
  DoneAction,
  PauseAction,
} from './replay/types.js';

export { Cursor } from './cursor/cursor.js';
export type {
  CursorConfig,
  CursorStyle,
  CursorActionPoint,
  CursorMoveOptions,
} from './cursor/cursor.js';
export {
  cubicBezier,
  easeInOut,
  easeOut,
  easeIn,
  easeOutBounce,
  linear,
} from './cursor/easing.js';

// ─── TTS Engine ────────────────────────────────────────────────────────────────

export {
  TtsEngine,
  PiperBackend,
  KokoroBackend,
  OpenAiBackend,
  ChatterboxBackend,
  generateLicenseFile,
  verifyModelSource,
} from './audio/tts/index.js';
export type {
  TtsBackend,
  BackendSynthesizeOptions,
  SynthesisResult,
  AudioFormat,
  TtsBackendName,
  AudioOutputMode,
  FallbackMode,
  OpenAiTtsConfig,
  TtsConfig,
  TtsSynthesisResult,
} from './audio/tts/types.js';

export type {
  CaptionStyle,
  DefaultCaptionStyle,
  CaptionEntry,
  BurnedInCaptionOptions,
  CaptionGenerationResult,
  CaptionFormat,
  SubtitleFilterOutput,
} from './audio/captions/types.js';

export { CaptionGenerator } from './audio/captions/generator.js';
export { BurnedInCaptions } from './audio/captions/burned-in.js';
export { SidecarCaptionWriter } from './audio/captions/sidecar-writer.js';

// ─── T11 Effects ───────────────────────────────────────────────────────────────

export { EffectsManager } from './effects/effects.js';
export type {
  EffectStyle,
  EffectConfig,
  EffectStep,
  ZoomEffect,
  DimEffect,
  CalloutEffect,
  CalloutPosition,
  SmoothScrollOptions,
} from './effects/types.js';

// ─── Capture Pipeline ──────────────────────────────────────────────────────────

export { CapturePipeline } from './capture/capture-pipeline.js';
export type {
  OutputMetadata,
  CaptureResult,
  CaptureFailure,
  CaptureResultUnion,
  EncodingOptions,
  Mp4EncodingOptions,
  WebmEncodingOptions,
  GifEncodingOptions,
  WebpEncodingOptions,
  QualityPreset,
  QualityPresetConfig,
  ProgressUpdate,
  ProgressCallback,
  CapturePipelineConfig,
} from './capture/types.js';

// ─── Screenshots ───────────────────────────────────────────────────────────────

export * from './screenshots/index.js';

// ─── T16 Matrix ────────────────────────────────────────────────────────────────

export {
  RenderMatrix,
  generateCellId,
  computeMatrixCombinations,
  generateOutputFilename,
  calculateSSIM,
} from './matrix/index.js';
export type {
  MatrixCellConfig,
  MatrixConfig,
  MatrixCellResult,
  MatrixRenderResult,
  CellDiff,
  StepDiff,
  DiffReport,
  MatrixRenderOptions,
} from './matrix/types.js';

// ─── Stage, narration, post-production ─────────────────────────────────────────

export { Stage, type StageOptions } from './stage/stage.js';
export { STAGE_SCRIPT } from './stage/stage-script.js';
export {
  prepareNarration,
  readingTimeMs,
  wavDurationMs,
  type NarrationClip,
  type NarrationOptions,
} from './narration/narration.js';
export {
  produceDeliverables,
  captionEntries,
  type DeliverableFormat,
  type ProduceOptions,
  type ProduceResult,
} from './produce/produce.js';
export type { NarrationEvent } from './replay/types.js';
export {
  renderDemo,
  type RenderDemoOptions,
  type RenderDemoResult,
} from './produce/render-demo.js';

// ─── Voice profiles (opt-in cloned narration voices) ──────────────────────────

export {
  voicesDir,
  voiceDir,
  isValidVoiceName,
  loadVoiceProfile,
  saveVoiceProfile,
  listVoiceProfiles,
  deleteVoiceProfile,
  usableVoiceProfile,
  sha256File,
  findVoiceToolchain,
  type VoiceProfile,
  type VoiceConsent,
  type VoiceToolchain,
} from './audio/voices/profiles.js';
