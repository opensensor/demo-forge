# DemoForge

**LLM-driven web product demo automation framework.**

DemoForge turns web applications into polished demo videos, GIFs, and interactive demo sites — automatically. Write a declarative demo script, and DemoForge replays it in a real browser, captures the action, adds narration and captions, and produces production-ready output assets.

```
demoforge.yaml          ← Declarative demo script
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  T6 CLI  ── orchestration, config loading, subcommands  │
│       │                                                 │
│       ├─ T10a Explorer Agent (LLM-driven discovery)     │
│       │                                                 │
│       └─ T9a Renderer (deterministic script replay)     │
│              │                                          │
│              ├─ T5 Browser (Playwright abstraction)     │
│              ├─ T9b Cursor (synthetic cursor overlay)   │
│              ├─ T11 Effects (zoom, spotlight, callouts) │
│              ├─ T15 Virtual Time (animation stabilization)│
│              └─ T9c Capture (ffmpeg encoding pipeline)  │
│                     │                                   │
│                     ├─ T12a TTS (narration audio)       │
│                     ├─ T12b Captions (SRT/VTT/burned-in)│
│                     └─ T13 Screenshots (annotation/redaction)
│                           │
│                           ▼
│              T17 Site (static demo gallery)
│              T16 Matrix (viewport/theme/locale variations)
└─────────────────────────────────────────────────────────┘
```

## Table of Contents

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Architecture Overview](#architecture-overview)
- [Demo Script Format](#demo-script-format)
- [CLI Reference](#cli-reference)
- [Configuration Reference](#configuration-reference)
- [API Reference](#api-reference)
- [Example Demo Scripts](#example-demo-scripts)
- [Dogfooding](#dogfooding)
- [Contributing](#contributing)

---

## Installation

### Prerequisites

| Dependency | Minimum Version | Purpose |
|---|---|---|
| Node.js | 20 (LTS) | Runtime |
| TypeScript | 5.x | Development |
| ffmpeg | 5.x | Video/GIF/WebP encoding |
| Playwright browsers | latest | Browser automation |
| llama-server | latest | LLM-powered exploration (optional for render-only) |

### Install

```bash
# Clone the repository
git clone https://github.com/your-org/demo-forge.git
cd demo-forge

# Install dependencies
npm install

# Build all packages
npm run build

# Verify the installation
npx demoforge --help
```

### System Dependencies

```bash
# ffmpeg (Debian/Ubuntu)
sudo apt-get install ffmpeg

# ffmpeg (macOS)
brew install ffmpeg

# Playwright browsers
npx playwright install chromium

# Verify all dependencies
npx demoforge doctor
```

---

## Quickstart

### 1. Initialize a project

```bash
npx demoforge init
```

This creates a `demoforge.yaml` scaffold in the current directory.

### 2. Write a demo script

Create `.demoforge/my-demo.json` with a valid Demo Script:

```json
{
  "demo": "my-demo",
  "title": "My First Demo",
  "viewport": { "width": 1280, "height": 720, "scale": 1 },
  "narration_mode": "none",
  "steps": [
    { "goto": "https://example.com" },
    { "narrate": "Welcome to the demo." },
    { "click": { "role": "link", "name": "More" } },
    { "wait_for": { "text": "Content loaded" } },
    { "done": true }
  ]
}
```

### 3. Render the demo

```bash
npx demoforge render my-demo
```

This produces video (MP4), GIF, and WebM output in `.demoforge/output/my-demo/`.

### 4. Generate a demo site

```bash
npx demoforge site
```

This creates a static HTML demo gallery in `dist/` with embedded videos and step timelines.

### 5. Explore a web app (requires llama-server)

```bash
# Start llama-server
llama-server --model ./models/llama-3.2-3b-instruct.Q4_K_M.gguf --port 8080

# Explore a web application
npx demoforge explore http://localhost:3000 --goal "Show the user onboarding flow"
```

---

## Architecture Overview

DemoForge is structured as an npm workspaces monorepo with five core packages:

| Package | Scope | Purpose |
|---|---|---|
| `@demoforge/core` | `packages/core` | Types, schemas, config, LLM client, explorer agent, seed hooks, heal engine |
| `@demoforge/browser` | `packages/browser` | Shared Playwright abstraction for browser session management |
| `@demoforge/cli` | `packages/cli` | CLI framework with Commander.js, subcommands, and command handlers |
| `@demoforge/renderer` | `packages/renderer` | Script replay engine, video capture, effects, TTS, captions, matrix rendering |
| `@demoforge/site` | `packages/site` | Static demo site generator with gallery and per-flow pages |

### Data Flow

```
demoforge.yaml ──► Config ──► CLI ──► Renderer ──► ffmpeg ──► Output assets
                        │              │
                        │              └─► Explorer Agent ──► LLM ──► Demo Script (JSON)
                        │
                        └─► Site Generator ──► HTML/CSS/JS ──► dist/
```

### Key Components

- **Demo Script**: A declarative YAML/JSON file describing the sequence of browser actions, narration, and timing. Validated against a Zod schema at load time.
- **Explorer Agent**: An LLM-driven agent that visits a web application, analyzes the accessibility tree, and proposes demo flows. Uses JSON schema response_format for action-space enforcement.
- **Renderer**: A deterministic script replayer that executes demo steps in a real browser, captures screencasts, and encodes them with ffmpeg.
- **Capture Pipeline**: ffmpeg orchestration for MP4 (H.264), WebM (VP9/AV1), GIF (palette-optimized), and Animated WebP encoding.
- **Effects**: CSS-based visual overlays — zoom/pan (Ken Burns), element spotlight, callout labels, smooth scroll easing.
- **TTS Engine**: Pluggable text-to-speech with Piper (local), Kokoro (local), and OpenAI (cloud) backends.
- **Captions**: SRT/VTT generation with configurable styling and burned-in subtitle support.
- **Render Matrix**: Produces multiple output variations from one script by varying viewport, theme (light/dark), and locale.
- **Heal Engine**: LLM-assisted selector repair when demo steps fail due to UI changes.

---

## Demo Script Format

A Demo Script is a JSON or YAML file with the following structure:

```json
{
  "demo": "my-flow",
  "title": "My Demo Flow",
  "viewport": { "width": 1280, "height": 720, "scale": 1 },
  "narration_mode": "none",
  "steps": [
    { "goto": "https://example.com" },
    { "click": { "role": "button", "name": "Sign Up" } },
    { "fill": { "target": { "role": "textbox", "name": "Email" }, "value": "user@example.com" } },
    { "narrate": "The user enters their email address." },
    { "done": true }
  ]
}
```

### Step Types

| Step | Key | Description |
|---|---|---|
| Navigation | `{ "goto": "<url>" }` | Navigate to a URL. Optional `settle` policy. |
| Click | `{ "click": <selector> }` | Click an element. Optional `effect` for visual highlight. |
| Hover | `{ "hover": <selector> }` | Hover over an element. |
| Fill | `{ "fill": { "target": <selector>, "value": "..." } }` | Fill an input. Optional `typing` style. |
| Select | `{ "select": { "target": <selector>, "value": "..." } }` | Select an option from a dropdown. |
| Press | `{ "press": { "key": "Enter" } }` | Press a keyboard key. |
| Scroll | `{ "scroll": { "amount": 500 } }` | Scroll the page by pixels. |
| Wait | `{ "wait_for": { "text": "Loaded" } }` | Wait for text or selector. |
| Narrate | `{ "narrate": "..." }` | Add narration text (for TTS/captions). |
| Screenshot | `{ "screenshot": { "name": "step-1" } }` | Capture a screenshot. |
| Flow Start | `{ "mark_flow_start": { "name": "flow-1" } }` | Mark the start of a named flow. |
| Flow End | `{ "mark_flow_end": { "name": "flow-1" } }` | Mark the end of a named flow. |
| Done | `{ "done": true }` | Signal the end of the demo. |
| Pause | `{ "pause": 2000 }` | Pause for N milliseconds. |

### Selectors

Selectors can be specified in five formats:

```json
{ "role": "button", "name": "Submit" }   { "label": "Email" }   { "text": "Sign In" }
{ "css": ".submit-btn" }                  { "xpath": "//button[@type='submit']" }   ".submit-btn"
```

---

## CLI Reference

### Global Options

| Option | Short | Description |
|---|---|---|
| `--config <path>` | | Path to a custom config file |
| `--verbose` | `-v` | Enable debug logging |
| `--quiet` | `-q` | Suppress non-error output |
| `--output <dir>` | | Default output directory |

### Commands

#### `demoforge init`

Initialize a new DemoForge project with a scaffold `demoforge.yaml`.

```bash
npx demoforge init
npx demoforge init -o ./my-project
```

**Options:**
| Option | Description |
|---|---|
| `-o, --output <dir>` | Directory to initialize in (default: current directory) |

#### `demoforge explore <url>`

Explore a web application and generate a demo script using the LLM explorer agent.

```bash
npx demoforge explore http://localhost:3000 --goal "Show the checkout flow"
npx demoforge explore http://localhost:3000 --goal "Demo the user dashboard" -o .demoforge
```

**Arguments:**
| Argument | Description |
|---|---|
| `<url>` | URL of the web application to explore |

**Options:**
| Option | Description |
|---|---|
| `--goal <goal>` | Description of the demo goal for the explorer |
| `-o, --output <dir>` | Output directory for the generated script (default: `.demoforge`) |

#### `demoforge render [flows...]`

Render demo scripts into video and other output assets.

```bash
npx demoforge render
npx demoforge render login dashboard
npx demoforge render login -o ./output --skip-seed
```

**Arguments:**
| Argument | Description |
|---|---|
| `[flows...]` | Flow names to render (default: all flows in `.demoforge/`) |

**Options:**
| Option | Description |
|---|---|
| `-o, --output <dir>` | Output directory for rendered assets |
| `--skip-seed` | Skip the seed-data hook before rendering |
| `--strict` | Fail if no seed hook is configured and app is in empty state |

#### `demoforge site`

Generate a static demo site from rendered flows.

```bash
npx demoforge site
npx demoforge site --output dist --title "Product Demos" --theme dark --validate
```

**Options:**
| Option | Description |
|---|---|
| `-o, --output <dir>` | Output directory for the static site (default: `dist`) |
| `-s, --source <dir>` | Source directory with rendered assets (default: `.demoforge/output`) |
| `-t, --title <title>` | Site title (default: `DemoForge Demos`) |
| `--theme <mode>` | Theme mode: `light` or `dark` (default: `light`) |
| `--no-search` | Disable search functionality |
| `--no-tags` | Hide tags on pages |
| `--no-metadata` | Hide metadata on flow pages |
| `--format <format>` | Default video format: `mp4`, `webm`, `gif`, `webp` (default: `mp4`) |
| `--validate` | Validate assets before generating site |

#### `demoforge doctor`

Check system dependencies and report status.

```bash
npx demoforge doctor
```

Checks: ffmpeg, Playwright browsers, llama-server, xvfb.

#### `demoforge heal [flows...]`

Repair broken selectors in demo scripts using LLM-assisted analysis.

```bash
npx demoforge heal login --step 3 --accept
npx demoforge heal login dashboard --step 2 --url http://localhost:3000
```

**Arguments:**
| Argument | Description |
|---|---|
| `[flows...]` | Flow names or script file patterns to heal (default: all scripts in `.demoforge/`) |

**Options:**
| Option | Description |
|---|---|
| `-a, --accept` | Automatically accept proposed repairs without review |
| `-o, --output <dir>` | Output directory for healed scripts (default: `.demoforge`) |
| `-s, --step <index>` | Step index to heal (default: auto-detect from render failure) |
| `-e, --error <message>` | Error message from render failure (for context) |
| `-u, --url <url>` | URL to navigate to for page state capture |

---

## Configuration Reference

### `demoforge.yaml`

Full configuration file with all options and defaults:

```yaml
# Project identification
demo: my-project
title: "My DemoForge Project"

# LLM endpoint (used by explorer agent and heal command)
llm:
  base_url: http://localhost:8080
  model: llama-3.2-3b-instruct
  context_budget: 4096

# Render matrix configuration
render:
  viewports:
    - width: 1440
      height: 900
  themes: [light, dark]
  locales: [en-US]

# Seed-data hook (runs before browser launch)
seed:
  # command: npx prisma db seed
  timeout: 30000

# Redaction rules for screenshot blurring
redaction: []

# Output format and size budgets
output:
  formats: [mp4, webm, gif]
  budgets:
    gif: 5242880  # 5 MB

# Narration configuration
narration:
  mode: none       # none | captions | tts
  voice:           # Optional: voice identifier for TTS
  speed: 1.0       # Optional: speech rate multiplier

# Explorer agent configuration
explorer:
  maxSteps: 50          # Maximum exploration steps
  maxTime: 60000        # Maximum exploration time (ms)
  guardrails:
    allowedOrigins: []  # Only allow navigation within these origins
    destructiveButtonPatterns:
      - "delete account"
      - "reset"
      - "empty database"
      - "permanently delete"
      - "wipe data"
    destructiveUrlPatterns: []
```

### Field Descriptions

| Field | Type | Default | Description |
|---|---|---|---|
| `demo` | string | *(required)* | Project identifier |
| `title` | string | `undefined` | Human-readable project title |
| `llm.base_url` | string | `http://localhost:8080` | OpenAI-compatible API base URL |
| `llm.model` | string | `llama-3.2-3b-instruct` | Model name |
| `llm.context_budget` | number | `4096` | Token budget for LLM context window |
| `render.viewports` | array | `[{width: 1440, height: 900}]` | Viewport dimensions for matrix rendering |
| `render.themes` | array | `[light, dark]` | Color scheme variations |
| `render.locales` | array | `[en-US]` | Locale variations |
| `seed.command` | string | `undefined` | Command to run for seed data |
| `seed.timeout` | number | `30000` | Seed hook timeout in ms |
| `redaction` | array | `[]` | Redaction rules for sensitive data |
| `output.formats` | array | `[mp4, webm, gif]` | Output formats to produce |
| `output.budgets.gif` | number | `5242880` | GIF size budget in bytes |
| `narration.mode` | string | `none` | Narration mode: `none`, `captions`, or `tts` |
| `narration.voice` | string | `undefined` | TTS voice identifier |
| `narration.speed` | number | `1.0` | TTS speech rate |
| `explorer.maxSteps` | number | `50` | Max exploration steps |
| `explorer.maxTime` | number | `60000` | Max exploration time (ms) |
| `explorer.guardrails.allowedOrigins` | array | `[]` | Allowed navigation origins |
| `explorer.guardrails.destructiveButtonPatterns` | array | *(defaults)* | Blocked destructive button patterns |
| `explorer.guardrails.destructiveUrlPatterns` | array | `[]` | Blocked destructive URL patterns |

---

## API Reference

### `@demoforge/core`

Core types, schemas, and utilities.

```typescript
import {
  // Types
  type DemoScript,
  type DemoStep,
  type Viewport,
  type Selector,
  type Effect,
  type NarrationMode,
  type ActionType,
  type ViewportConfig,
  type RenderMatrix,

  // Schemas
  demoScriptSchema,
  demoStepSchema,
  validateDemoScript,

  // Errors
  DemoForgeError,
  ValidationError,
  RenderError,
  ExplorerError,
  HealError,
  ConfigError,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmApiError,
  SeedError,

  // LLM client
  LlmClient,
  TokenCounter,
  plannerConfig,
  copywriterConfig,

  // Config
  type Config,
  type LLMConfig,
  type RenderConfig,
  type SeedConfig,
  type ExplorerConfig,
  defaults,
  loadConfig,
  initConfig,

  // Explorer agent
  ExplorerAgent,
  Guardrails,

  // Seed hook
  runSeedHook,

  // Heal engine
  type HealConfig,
  type FailingStep,
  type HealResult,
  healStep,
  applyPatches,
  extractFailingStep,

  // Logger
  createLogger,
  createSilentLogger,
  createDebugLogger,
} from "@demoforge/core";
```

### `@demoforge/browser`

Shared Playwright abstraction.

```typescript
import {
  BrowserSession,
  BrowserSetup,
  resolveSelector,
} from "@demoforge/browser";

// Usage
const browser = new BrowserSession({
  headless: true,
  viewport: { width: 1280, height: 720 },
});
await browser.launch();
await browser.goto("https://example.com");
await browser.click({ role: "link", name: "More" });
await browser.screenshot({ fullPage: true });
await browser.close();
```

### `@demoforge/renderer`

Script replay engine and video capture.

```typescript
import {
  // Replay
  Renderer,
  RenderError,
  stabilityDetect,
  detectCSP,
  accessibilityDiff,

  // Virtual time
  VirtualTimeController,

  // Cursor
  Cursor,
  cubicBezier,
  easeInOut,
  easeOut,

  // TTS
  TtsEngine,
  PiperBackend,
  KokoroBackend,
  OpenAiBackend,
  generateLicenseFile,

  // Captions
  CaptionGenerator,
  BurnedInCaptions,
  SidecarCaptionWriter,

  // Effects
  EffectsManager,

  // Capture
  type CapturePipelineConfig,

  // Matrix
  RenderMatrix,
  generateCellId,
  computeMatrixCombinations,
  calculateSSIM,
} from "@demoforge/renderer";
```

### `@demoforge/site`

Static demo site generator.

```typescript
import { SiteGenerator } from "@demoforge/site";

const generator = new SiteGenerator("./dist", {
  siteTitle: "My Demos",
  searchEnabled: true,
  showTags: true,
  showMetadata: true,
  defaultVideoFormat: "mp4",
  theme: {
    mode: "light",
    colors: { primary: "#3b82f6" },
    fonts: { heading: "Inter, sans-serif" },
  },
});

// Discover and add flows
generator.addFlow(flowConfig);

// Generate the site
generator.generate();

// Validate assets
const result = generator.validateAssets();
```

---

## Example Demo Scripts

See the `examples/` directory for complete, schema-validated demo scripts:

| Script | Description | Steps |
|---|---|---|
| `examples/login-flow.json` | User login flow with form fill and dashboard landing | 10 |
| `examples/dashboard-walkthrough.json` | Dashboard navigation with metric highlights | 12 |
| `examples/form-submission.json` | Contact form with validation and success confirmation | 14 |

### Running example scripts

```bash
# Place example scripts in .demoforge/
cp examples/*.json .demoforge/

# Render all example demos
npx demoforge render

# Render a specific example
npx demoforge render login-flow
```

---

## Dogfooding

DemoForge produces its own demo assets using the full pipeline:

```bash
# Build DemoForge first
npm run build

# Run dogfooding: produce demo assets using DemoForge itself
# This exercises: CLI, renderer, capture pipeline, TTS, captions, site generator

# 1. Render demo assets
npx demoforge render --source examples --output demo-assets

# 2. Generate demo site from dogfood assets
npx demoforge site --source demo-assets --output demo-site

# 3. Verify the site
open demo-site/index.html
```

The dogfooding pipeline uses:
- **T6 CLI** for orchestration (`demoforge render`, `demoforge site`)
- **T9a Renderer** for script replay and browser capture
- **T9c Capture** for ffmpeg encoding (MP4, WebM, GIF)
- **T12a TTS** for narration audio (Piper/Kokoro/OpenAI backends)
- **T12b Captions** for SRT/VTT caption generation and burned-in subtitles
- **T17 Site** for demo gallery generation

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details on:

- Monorepo development workflow
- Running tests and building
- Adding new packages
- Code style and linting
- Submitting pull requests

---

## License

MIT
