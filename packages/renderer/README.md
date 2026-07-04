# @demoforge/renderer

Script replay engine, video capture pipeline, visual effects, TTS, captions, and render matrix for DemoForge.

## Package Contents

| Module | Description |
|---|---|
| `replay` | `Renderer` class — deterministic script replayer with timeout, failure output, CSP detection, stability detection |
| `cursor` | `Cursor` class — synthetic cursor with Bezier-eased movement and click ripple animation |
| `capture` | `CapturePipeline` class — ffmpeg orchestration for MP4, WebM, GIF, WebP encoding |
| `audio/tts` | `TtsEngine` with pluggable backends: Piper, Kokoro, OpenAI |
| `audio/captions` | `CaptionGenerator` (SRT/VTT), `BurnedInCaptions` (ffmpeg subtitle overlay), `SidecarCaptionWriter` |
| `effects` | `EffectsManager` — zoom/pan, spotlight, callout labels, smooth scroll easing |
| `screenshots` | `ScreenshotCapture` — full-page/element screenshots with annotation and redaction |
| `virtual-time` | `VirtualTimeController` — CDP virtual time injection for animation stabilization |
| `matrix` | `RenderMatrix` — viewport/theme/locale variation rendering with SSIM diff reports |

## Installation

This package is part of the DemoForge monorepo. Install via the workspace:

```bash
npm install
npm run build
```

Then import in your code:

```typescript
import {
  Renderer,
  CapturePipeline,
  EffectsManager,
  TtsEngine,
  CaptionGenerator,
  RenderMatrix,
} from "@demoforge/renderer";
```

## Usage

### Renderer

```typescript
import { Renderer } from "@demoforge/renderer";
import { BrowserSession } from "@demoforge/browser";

const browser = new BrowserSession({ headless: true });
const renderer = new Renderer({
  browser,
  script: demoScript,
  config: {
    globalTimeout: 120000,
    stepTimeout: 30000,
    defaultSettle: "load",
  },
});

const result = await renderer.render();
console.log(result.steps); // StepResult[]
console.log(result.status); // "success" | "failure" | "timeout"
```

### Capture Pipeline

```typescript
import { CapturePipeline } from "@demoforge/renderer";

const pipeline = new CapturePipeline({
  qualityPreset: "balanced",
  outputFormats: ["mp4", "webm", "gif"],
  outputDir: ".demoforge/output/demo",
});

const result = await pipeline.encode({
  inputPath: "screencast.webm",
  options: {
    mp4: { crf: 23, preset: "medium" },
    gif: { scale: "0.5", fps: 10, budget: 5 * 1024 * 1024 },
  },
});

console.log(result.metadata); // OutputMetadata
```

### Effects Manager

```typescript
import { EffectsManager } from "@demoforge/renderer";

const effects = new EffectsManager(browser);
await effects.inject();

// Apply zoom effect at timestamp
await effects.applyZoom({ scale: 1.2, x: 0.5, y: 0.5, atTime: 2000, duration: 1000 });

// Apply spotlight/dim effect
await effects.applyDim({ selector: { role: "button", name: "Submit" }, atTime: 3000 });

// Apply callout label
await effects.applyCallout({
  selector: { role: "heading", name: "Welcome" },
  text: "Key metric",
  position: "top-right",
  atTime: 4000,
});

await effects.cleanup();
```

### TTS Engine

```typescript
import { TtsEngine, PiperBackend } from "@demoforge/renderer";

const tts = new TtsEngine({
  backend: new PiperBackend(),
  config: {
    enabled: true,
    outputMode: "embedded",
    fallbackMode: "captions-only",
  },
});

const result = await tts.synthesize("Welcome to the demo.");
console.log(result.audio); // Buffer
console.log(result.durationMs); // number
```

### Caption Generator

```typescript
import { CaptionGenerator, SidecarCaptionWriter } from "@demoforge/renderer";

const generator = new CaptionGenerator();
const entries = generator.entriesFromNarrateSteps(demoScript.steps);

// Generate SRT
const srt = generator.generateSRT(entries);
// Generate VTT
const vtt = generator.generateVTT(entries);

// Write sidecar files
const writer = new SidecarCaptionWriter();
await writer.writeSRT(entries, "./output/captions.srt");
await writer.writeVTT(entries, "./output/captions.vtt");
```

### Render Matrix

```typescript
import { RenderMatrix } from "@demoforge/renderer";

const matrix = new RenderMatrix({
  browserFactory: () => new BrowserSession({ headless: true }),
  config: {
    viewports: [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ],
    themes: ["light", "dark"],
    locales: ["en-US", "es-ES"],
  },
  script: demoScript,
  rendererConfig: { globalTimeout: 120000 },
});

const result = await matrix.render();
console.log(result.cells); // MatrixCellResult[]
console.log(result.diffReport); // DiffReport
```

## Types

```typescript
interface RenderConfig {
  globalTimeout?: number;
  stepTimeout?: number;
  defaultSettle?: "load" | "domcontentloaded" | "networkidle";
  outputDir?: string;
  captureOnFailure?: boolean;
  stabilityAttempts?: number;
}

interface CapturePipelineConfig {
  qualityPreset?: "max" | "balanced" | "small";
  outputFormats?: ("mp4" | "webm" | "gif" | "webp")[];
  outputDir: string;
}

interface TtsConfig {
  enabled: boolean;
  backend: "piper" | "kokoro" | "openai";
  outputMode: "embedded" | "sidecar";
  fallbackMode: "none" | "captions-only";
}
```

## Tests

```bash
npx vitest run packages/renderer
```

200+ tests covering renderer, cursor, capture pipeline, TTS, captions, effects, screenshots, virtual time, and matrix rendering.
