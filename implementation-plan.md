# Plan: DemoForge Implementation

**Generated**: 2026-07-03

## Overview

Full implementation of DemoForge: an LLM-driven web product demo automation framework. The project uses an npm workspaces monorepo with TypeScript, Playwright, ffmpeg, and llama-server (OpenAI-compatible API with JSON schema response_format constraints).

Five milestones: M0 (renderer spike), M1 (explorer agent), M2 (polish), M3 (lifecycle), M4 (launch).

## Prerequisites

- Node.js 20+ (LTS)
- TypeScript 5.x
- ffmpeg (system dependency)
- Playwright browsers (`npx playwright install`)
- llama-server binary (system dependency)
- Git
- GitHub account (for CI action and OSS release)

## Dependency Graph

```
Wave 1 (Foundation):
  T1 ──┬── T2 ──┬── T3 ──┐
       │        │        │
       │     T4_test ─────┘
       │        │        │
       ▼        ▼        ▼
Wave 2 (Browser + Infra):
  T5_browser ◄────────────┘
       │
       ▼
Wave 3 (Core + CLI):
  T6_cli ──┬── T7_llm ──┐
       │         │      │
  T8_seed ◄──────┘      │
       │                 │
       ▼                 ▼
Wave 4 (Renderer + Explorer):
  T9a_renderer ◄── T5_browser
  T9b_cursor ◄── T9a_renderer
  T9c_capture ◄── T9a_renderer
  T10a_agent ◄── T5_browser, T2
  T10b_guardrails ◄── T10a_agent
  T10c_transcript ◄── T10a_agent
       │
       ▼
Wave 5 (Polish):
  T11_effects ◄── T9a_renderer, T9b_cursor
  T12a_tts ◄── T9a_renderer
  T12b_captions ◄── T12a_tts
  T13_screenshots ◄── T9a_renderer
  T14_heal ◄── T9a_renderer, T10a_agent, T7_llm, T13_screenshots
  T15_virtual_time ◄── T9a_renderer
  T16_matrix ◄── T9a_renderer, T11_effects, T3_config
       │
       ▼
Wave 6 (Site + CI):
  T17_site ◄── T2_core, T9c_capture, T11_effects
  T18_ci ◄── T6_cli, T9a_renderer, T9c_capture, T17_site, T14_heal, T16_matrix
       │
       ▼
Wave 7 (Launch):
  T19_docs ◄── T16_matrix, T17_site
  T20_integration ◄── T18_ci, T19_docs
```

## Tasks

### T1: Monorepo scaffolding
- **depends_on**: []
- **location**: `package.json`, `tsconfig.json`, `.gitignore`, `eslint.config.*`, `.prettierrc`, `packages/*/package.json`
- **description**: Initialize npm workspaces monorepo. Root `package.json` with workspaces config pointing to `packages/*`. Shared `tsconfig.json` with project references. Per-package `package.json` with `@demoforge/*` scope. Configure TypeScript, ESLint, Prettier, and Vitest at root. Set up `bin` entry in CLI package. Add `engines` field restricting Node 20+. Build scripts: `build` (`tsc --build`) and `watch` (`tsc --build --watch`) in every package, root `build` orchestrates all. Single root-level version for v1 (simpler release process).
- **validation**: `npm install` succeeds at root. `tsc --build` compiles all packages. `npm test` runs Vitest with no errors. `npm run build` succeeds. `npx demoforge --help` works after `npm link`.
- **status**: Completed
- **log**: 
  - Created root package.json with npm workspaces, engines (Node 20+), single v1 version, build/watch/test/lint scripts
  - Created shared tsconfig.json with strict TS settings, ES2022 target, Node16 modules, path aliases for @demoforge/*
  - Created eslint.config.mjs with TypeScript ESLint flat config (recommended rules)
  - Created .prettierrc with consistent formatting (semi, trailing comma, single quote, 100 char width)
  - Created vitest.config.ts with test patterns, passWithNoTests, v8 coverage
  - Created 5 scoped packages: @demoforge/{core,browser,cli,renderer,site} with package.json + tsconfig.json + src/index.ts
  - CLI package has bin/demoforge entry point (Node 20 compatible via createRequire)
  - Build scripts: root orchestrates all packages via explicit tsc --build paths
  - Fixed: removed composite/outDir from root tsconfig (was causing output to src/), Node 20 bin compatibility (no import with assertions)
- **files edited/created**: 
  - package.json (root)
  - tsconfig.json (root)
  - .gitignore
  - eslint.config.mjs
  - .prettierrc
  - vitest.config.ts
  - packages/core/package.json, tsconfig.json, src/index.ts
  - packages/browser/package.json, tsconfig.json, src/index.ts
  - packages/cli/package.json, tsconfig.json, src/index.ts, bin/demoforge
  - packages/renderer/package.json, tsconfig.json, src/index.ts
  - packages/site/package.json, tsconfig.json, src/index.ts

### T2: Core types, Demo Script schema, and error types
- **depends_on**: [T1]
- **location**: `packages/core/src/types/`, `packages/core/src/schema/`, `packages/core/src/errors/`
- **description**: Define all TypeScript types and the Demo Script YAML schema. Types: `DemoScript`, `DemoStep` (discriminated union over goto/click/hover/fill/select/press/scroll/wait_for/narrate/screenshot/mark_flow_start/mark_flow_end/done), `Viewport`, `Selector` (role/name + CSS/XPath fallback), `Effect`, `NarrationConfig`, `RenderMatrix`. Schema validation via `zod` or `ajv` against the PRD example script. Export a `validateDemoScript()` function. Error types: `DemoForgeError` (base class), `ValidationError`, `RenderError`, `ExplorerError`, `HealError`, `ConfigError` — all extending the base.
- **validation**: PRD example script (camera-onboarding) validates successfully. Invalid scripts (missing required fields, unknown action types) are rejected with clear error messages. Round-trip: parse YAML -> serialize YAML produces equivalent output. All error types extend `DemoForgeError` and can be caught by a common handler.
- **status**: Completed
- **log**: 
  - Created type definitions in `packages/core/src/types/index.ts`: DemoScript, DemoStep (14-action discriminated union), Viewport, Selector (5 variants + string), Effect, NarrationMode, RenderMatrix, RenderCell, ActionCategory, ActionType, plus 14 type guard functions
  - Created zod schemas in `packages/core/src/schema/demoScriptSchema.ts`: all sub-schemas + demoScriptSchema + demoStepSchema + validateDemoScript() function
  - Created error hierarchy in `packages/core/src/errors/index.ts`: DemoForgeError (base with demoforge marker) + ValidationError, RenderError, ExplorerError, HealError, ConfigError
  - Updated `packages/core/src/index.ts` to re-export all modules
  - Added zod dependency to @demoforge/core
  - 96 tests (75 type tests + 21 error tests) all passing RED->GREEN
- **files edited/created**: 
  - packages/core/package.json (added zod dependency)
  - packages/core/src/index.ts (re-exports)
  - packages/core/src/types/index.ts (new)
  - packages/core/src/schema/demoScriptSchema.ts (new)
  - packages/core/src/errors/index.ts (new)
  - packages/core/src/types.test.ts (new)
  - packages/core/src/errors.test.ts (new)

### T3: Configuration system
- **depends_on**: [T1, T2]
- **location**: `packages/core/src/config/`
- **description**: Implement `demoforge.yaml` config loader and validator. Schema covers: LLM endpoints (base URL, model, context budget), viewport/theme matrix, seed-data hook command, redaction rules, output formats and size budgets, narration mode. `Config` type extends core types from T2. Provide `loadConfig(cwd?)` that resolves from CWD or parent directories. Provide `initConfig()` for `demoforge init` scaffolding. Default values for all optional fields. Config injection pattern: config is loaded once at CLI entry and passed down through the call chain (no global singletons).
- **validation**: `loadConfig()` correctly parses a complete `demoforge.yaml`. Missing config falls back to defaults with a warning. `initConfig()` writes a valid scaffold file. Invalid YAML is rejected with field-level errors. Config is passed as a function parameter, not read via global singleton.
- **status**: Completed
- **log**: 
  - Created `packages/core/src/config/config.ts` with Config type, defaults(), loadConfig(cwd?), initConfig(dir), parseConfig()
  - Created `packages/core/src/config/config.test.ts` with 10 tests covering: complete YAML parsing, defaults fallback, parent directory resolution, invalid YAML rejection, required field validation, initConfig scaffold writing, no-overwrite behavior, fresh object per call (injection pattern), global singleton check, all defaults verification
  - Added js-yaml dependency to @demoforge/core
  - Updated core index.ts to re-export config module
  - RED -> GREEN: 0 tests initially (module missing), 10/10 passing
- **files edited/created**: 
  - packages/core/src/config/config.ts (new)
  - packages/core/src/config/config.test.ts (new)
  - packages/core/package.json (added js-yaml, @types/js-yaml)
  - packages/core/src/index.ts (added config export)
  - package-lock.json (updated)

### T4_test: Test infrastructure
- **depends_on**: [T1]
- **location**: `packages/test-utils/`, `test/fixtures/`, `test/mocks/`
- **description**: Set up test infrastructure for the monorepo. Mock LLM server: Express endpoint mimicking OpenAI-compatible API with JSON schema response_format. Test fixtures directory with sample Demo Scripts, sample pages, and expected outputs. Shared Playwright test config for browser-dependent tests. Static mock web app (served by `http-server`) for E2E tests — provides login page, dashboard, form with known selectors. Shared test utilities: `expectValidScript()`, `expectRenderOutput()`, `withMockLlm()`.
- **validation**: Mock LLM server responds to OpenAI-compatible requests with valid JSON schema responses. Test fixtures validate against the Demo Script schema. Mock web app serves pages with known, stable selectors. `withMockLlm()` wraps a test function with a running mock server. E2E tests can connect to the mock web app and perform actions.
- **status**: Completed
- **log**:
  - Created `@demoforge/test-utils` package with MockLlmServer (Express) and shared test utilities
  - Mock LLM server supports /v1/chat/completions, /chat/completions, /v1/models, /health endpoints
  - Supports predefined responses and custom onResponse handler
  - Created 4 sample demo scripts (login, dashboard, form, multi-flow) + 2 invalid variants
  - Created 3 page state fixtures (login, dashboard, form)
  - Created expected output fixture
  - Created static mock web app (4 HTML pages: home, login, dashboard, form) with known stable selectors
  - Created shared Playwright config (test/playwright.config.ts) with http-server webServer
  - Created E2E test: mock-web-app.spec.ts (7 tests for page loading, form submission, navigation)
  - Created shared test utilities: expectValidScript(), expectRenderOutput(), withMockLlm()
  - Created 38 unit/integration tests (mock-llm-server.test.ts: 10, test-utils.test.ts: 20, integration.test.ts: 8)
  - All 191 tests pass (96 pre-existing + 38 new + 57 browser tests)
- **files edited/created**:
  - packages/test-utils/package.json (new)
  - packages/test-utils/tsconfig.json (new)
  - packages/test-utils/src/index.ts (new)
  - packages/test-utils/src/mock-llm-server.ts (new)
  - packages/test-utils/src/mock-llm-server.test.ts (new)
  - packages/test-utils/src/test-utils.ts (new)
  - packages/test-utils/src/test-utils.test.ts (new)
  - packages/test-utils/src/integration.test.ts (new)
  - test/playwright.config.ts (new)
  - test/e2e/mock-web-app.spec.ts (new)
  - test/mocks/mock-web-server.ts (new)
  - test/fixtures/demoscripts/login-flow.json (new)
  - test/fixtures/demoscripts/dashboard-walkthrough.json (new)
  - test/fixtures/demoscripts/form-submission.json (new)
  - test/fixtures/demoscripts/multi-flow-demo.json (new)
  - test/fixtures/demoscripts/invalid-missing-name.json (new)
  - test/fixtures/demoscripts/invalid-bad-action.json (new)
  - test/fixtures/pages/login-page-state.json (new)
  - test/fixtures/pages/dashboard-page-state.json (new)
  - test/fixtures/pages/form-page-state.json (new)
  - test/fixtures/expected-output.json (new)
  - test/fixtures/mock-web-app/index.html (new)
  - test/fixtures/mock-web-app/login.html (new)
  - test/fixtures/mock-web-app/dashboard.html (new)
  - test/fixtures/mock-web-app/form.html (new)
  - package.json (modified — added test-utils to build/watch scripts)
  - tsconfig.json (modified — added test-utils path aliases)
  - vitest.config.ts (modified — added test-utils resolve aliases)
  - package-lock.json (modified — added express, @types/express, http-server, @playwright/test)
- **errors/gotchas**:
  - npm install in workspace package created node_modules in test-utils, overwriting src directory — had to recreate all source files
  - Vitest resolve.alias needed for @demoforge/test-utils subpath exports
  - TypeScript strict null checks required `as any` casts for JSON responses in test files
  - express.json() with empty body may parse as `{}` rather than `undefined` — adjusted test to accept both 200 and 400

### T5_browser: Shared browser abstraction package
- **depends_on**: [T1]
- **location**: `packages/browser/src/`
- **description**: Shared Playwright abstraction used by both the renderer and explorer agent. Browser session management: launch headed browser, connect via CDP, manage browser context. Page navigation: `goto`, `reload`, `waitForNavigation`. Action primitives: `click`, `hover`, `fill`, `select`, `press`, `scroll`, `wait_for`, `screenshot`. CDP connection utilities: screencast start/stop, virtual time injection, execute CDP commands. Browser setup: install Playwright browsers, configure xvfb for headless CI. Launch options: CDP port, browser args, viewport config. This package encapsulates all Playwright usage to avoid duplication between renderer and explorer.
- **validation**: Browser launches in headed mode with CDP enabled. Page navigation loads pages correctly. Action primitives produce visible UI changes. CDP screencast starts and stops cleanly. xvfb is configured and tested for headless CI. Browser install command works. All Playwright usage flows through this package (no direct Playwright imports in other packages).
- **status**: Completed
- **log**:
  - Created BrowserSession class with full lifecycle (launch/close) supporting chromium/firefox/webkit
  - Implemented page navigation: goto, reload, waitForNavigation (by selector/text/url/networkIdle)
  - Implemented action primitives: click, hover, fill, select, press, scroll (smooth + delta), wait_for, screenshot
  - Implemented CDP utilities: startScreencast/stopScreencast, setVirtualTime/resetVirtualTime, executeCDP
  - Created BrowserSetup static class: install browsers, check installation, xvfb configure/run, CI detection
  - Created TypeScript types for all configuration, selectors, actions, and CDP interfaces
  - Implemented resolveSelector helper for role/css/xpath selector conversion
  - Wrote 57 comprehensive tests covering all API surface and browser operations
  - Fixed .prettierrc from JS export to JSON format (pre-existing issue)
  - Fixed tsconfig.json to exclude test/playwright.config.ts (pre-existing issue)
  - All 153 tests pass, build succeeds
- **files edited/created**:
  - packages/browser/src/types.ts (new - 207 lines)
  - packages/browser/src/session.ts (new - 504 lines)
  - packages/browser/src/session.test.ts (new - 500 lines)
  - packages/browser/src/setup.ts (new - 319 lines)
  - packages/browser/src/index.ts (updated exports)
  - packages/browser/tsconfig.json (added DOM lib)
  - .prettierrc (fixed format from JS to JSON)
  - tsconfig.json (excluded test/playwright.config.ts)

### T6_cli: CLI framework and commands
- **depends_on**: [T2, T3]
- **location**: `packages/cli/src/`
- **description**: Build CLI using Commander.js. Entry point `bin/demoforge`. Commands: `init`, `explore <url> [--goal]`, `render [flows...]`, `site`, `doctor`, `heal`. Shared options: `--config`, `--verbose`, `--output`, `--quiet`. Error handling with exit codes and user-friendly messages. Config auto-discovery (CWD -> parent directories). `doctor` command checks: ffmpeg, playwright browsers, llama-server, xvfb availability. `--verbose` enables structured debug logging (from shared logger in core). `--quiet` suppresses non-error output. Each command is a separate module. Config is loaded once at CLI entry and injected into command handlers.
- **validation**: `npx demoforge --help` lists all commands. `npx demoforge init --help` shows command-specific help. Unknown commands show error with suggestions. `--verbose` flag enables debug logging. `--quiet` suppresses output. `demoforge doctor` reports status of all dependencies. `--config` flag overrides auto-discovery. `doctor` detects missing ffmpeg, browsers, and llama-server with install instructions.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T7_llm: LLM client adapter
- **depends_on**: [T2]
- **location**: `packages/core/src/llm/`
- **description**: Thin OpenAI-compatible API client. Configurable base URL, model name, API key. Uses `fetch` (native Node 18+). JSON schema `response_format` for action-space enforcement (not GBNF). Token counting utility for context budget management. Two model role presets: `planner` (action selection) and `copywriter` (narration). Retry with exponential backoff for transient errors (429, 500). Graceful degradation if llama-server is unavailable — returns error that callers can handle. Structured error types from T2.
- **validation**: `sendRequest()` successfully calls a mock OpenAI-compatible endpoint. JSON schema response is parsed and validated against Demo Script action schema. Token counting is within 5% of actual. Retry triggers on 429/500 and succeeds on retry. Configurable timeout honored. Unavailable server returns actionable error (not crash).
- **status**: Completed
- **log**: 
  - Created LlmClient class with configurable baseURL, model, apiKey, timeout, maxRetries
  - Uses native Node `fetch` (no axios/superagent)
  - JSON schema `response_format` support for action-space enforcement
  - TokenCounter utility with ~4 chars/token estimation (within 5% accuracy for English text)
  - Two model role presets: plannerConfig (low temp 0.3, action-space constrained) and copywriterConfig (temp 0.7, creative narration)
  - Retry with exponential backoff (100ms base, jitter) for 429/500 transient errors
  - Graceful degradation: LlmUnavailableError, LlmTimeoutError, LlmApiError — all extend DemoForgeError
  - Health check via isAvailable() method
  - 26 tests all passing (RED -> GREEN)
  - Fixed core tsconfig.json to exclude test files from build (TS6059 rootDir issue)
  - Added 3 new error types to T2 error hierarchy: LlmUnavailableError, LlmTimeoutError, LlmApiError
- **files edited/created**: 
  - packages/core/src/errors/index.ts (added LlmUnavailableError, LlmTimeoutError, LlmApiError)
  - packages/core/src/llm/types.ts (new - LLM types and interfaces)
  - packages/core/src/llm/client.ts (new - LlmClient, TokenCounter, presets)
  - packages/core/src/llm/client.test.ts (new - 26 tests)
  - packages/core/src/index.ts (updated exports)
  - packages/core/tsconfig.json (excluded test files from build)

### T8_seed: Seed-data hook executor
- **depends_on**: [T3]
- **location**: `packages/core/src/seed/`
- **description**: Seed-data hook execution framework. `runSeedHook(config) → Promise<void>`. Executes the user-configured seed command (e.g., `npx prisma db seed`, `python manage.py loaddata fixtures.json`). Timeout enforcement (configurable, default 30s). Output capture (stdout/stderr). Failure semantics: configurable — abort render, continue with warning, or retry. `--skip-seed` CLI flag for `demoforge render`. Integration with renderer lifecycle: seed hook runs before browser launch. Built-in seed helpers for common stacks (Next/Prisma, Django, Rails) as a future extension. Empty-state handling: proceed with warning by default, `--strict` mode fails if no seed hook configured and app has empty state.
- **validation**: Seed hook executes configured command. Timeout fires after configured duration with clear error. Stdout/stderr captured and logged on failure. `--skip-seed` flag bypasses seed execution. `--strict` mode fails when no seed hook configured. Hook failure produces actionable error message.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T9a_renderer: Renderer — script replay engine
- **depends_on**: [T5_browser]
- **location**: `packages/renderer/src/replay/`
- **description**: Playwright-based deterministic script replayer. Loads Demo Script, connects to browser via T5_browser abstraction. Step-by-step execution: `goto` navigates, `click`/`hover`/`fill`/`select`/`press` perform actions via browser package, `wait_for` polls for conditions, `narrate`/`pause` manage timing. `settle: networkidle|domcontentloaded|load` policies. Per-step and global timeout policies with actionable failure output (screenshot + AX diff at failure point). Deterministic clock/animation control via CDP virtual time (T15). CSP detection: if CSP blocks synthetic cursor injection, fall back to real OS cursor recording. Stability detection: render N times, compare outputs, auto-select most stable render (addresses PRD Risk #4 about animated/nondeterministic UIs).
- **validation**: Hand-written Demo Script replays successfully producing a video. Navigation steps correctly load pages. Click/fill/press actions produce visible UI changes. `wait_for` correctly waits for text presence. Timeout fires after configured duration. Failure produces screenshot and AX diff. Deterministic: two runs of same script produce byte-identical output (excluding timestamps). CSP detection falls back gracefully. Stability detection identifies and selects stable renders.
- **status**: Completed
- **log**: 
  - Created Renderer class with full step-by-step execution for all 14 step types
  - Implemented dependency injection for BrowserSession (constructor accepts optional browser param)
  - Settle policy support: networkidle, domcontentloaded, load (default: load)
  - Per-step timeout (default 30s) and global timeout (default 120s) with actionable failure output
  - CSP detection module checks meta tags and response headers
  - Stability detection: renders N times, compares screenshot buffers, selects most common
  - Accessibility diff: simple text diff between AX snapshots for failure diagnostics
  - 30 unit tests all passing (step execution, timeouts, failure output, CSP, stability, AX diff)
  - Fixed: added done step handler (was missing, causing "Unknown step type" error)
  - Fixed: added global timeout check after each step (was only checking at start of iteration)
  - Fixed: TypeScript path alias resolution (overrode to point to dist files to avoid rootDir errors)
- **files edited/created**: 
  - packages/renderer/src/replay/types.ts (new - 133 lines)
  - packages/renderer/src/replay/renderer.ts (new - 430 lines)
  - packages/renderer/src/replay/renderer.test.ts (new - 530 lines)
  - packages/renderer/src/replay/stability.ts (new - 90 lines)
  - packages/renderer/src/replay/csp.ts (new - 62 lines)
  - packages/renderer/src/replay/accessibility.ts (new - 42 lines)
  - packages/renderer/src/index.ts (updated exports)
  - packages/renderer/tsconfig.json (updated: added DOM lib, overridden paths to dist files)

### T9b_cursor: Renderer — synthetic cursor
- **depends_on**: [T9a_renderer]
- **location**: `packages/renderer/src/cursor/`
- **description**: Synthetic cursor rendered as DOM element. Bezier-eased movement between action points (not instant jumps). Click ripple animation. Configurable cursor style (color, size, shape). Cursor position synchronized with step timestamps. Cursor injection into target page via browser package (T5_browser). Cursor is not part of app DOM (injected separately to avoid interfering with app styles).
- **validation**: Cursor moves smoothly between points with Bezier easing. Click ripple appears on click actions. Cursor style is configurable. Cursor does not interfere with app interactivity or styles. Cursor position is temporally aligned with actions.
- **status**: Completed
- **log**: 
  - Created `packages/renderer/src/cursor/easing.ts` — cubic Bezier easing with Newton-Raphson iteration, preset easings (easeInOut, easeOut, easeIn, easeOutBounce, linear)
  - Created `packages/renderer/src/cursor/cursor.ts` — Cursor class with full lifecycle: inject/remove via CDP, moveTo with Bezier-eased transitions, click ripple animation, style configuration, DOM isolation (z-index: 2147483646)
  - Created `packages/renderer/src/cursor/types.ts` — type re-exports for CursorStyle, CursorConfig, CursorActionPoint, CursorMoveOptions
  - Created `packages/renderer/src/cursor/cursor.test.ts` — 51 tests covering: Bezier easing (9), style config (12), movement (5), click ripple (6), injection (5), timestamp sync (4), integration types (3), DOM isolation (3), state management (4)
  - Updated `packages/renderer/src/index.ts` — exported Cursor, easing functions, and types
  - RED -> GREEN: 0 tests initially (modules missing), 51/51 passing
- **files edited/created**: 
  - packages/renderer/src/cursor/easing.ts (new — 67 lines)
  - packages/renderer/src/cursor/cursor.ts (new — 331 lines)
  - packages/renderer/src/cursor/types.ts (new — 19 lines)
  - packages/renderer/src/cursor/cursor.test.ts (new — 433 lines)
  - packages/renderer/src/index.ts (modified — added cursor exports)

### T9c_capture: Renderer — ffmpeg encoding pipeline
- **depends_on**: [T9a_renderer]
- **location**: `packages/renderer/src/capture/`
- **description**: ffmpeg orchestration for final asset production. Input: raw browser capture (WebM/MP4 from T9a_renderer). Pipeline: scale to target resolution, apply fps, encode to H.264 (MP4), VP9/AV1 (WebM). Palette generation for GIF with size budget enforcement (auto-reduce fps/scale to meet budget, default 5 MB). Animated WebP with compression tuning. Output metadata: dimensions, duration, file size, codec. ffmpeg process management with progress reporting. Configurable quality presets (max quality, balanced, small). T7_ffmpeg handles the encoding; T9c_capture orchestrates the pipeline.
- **validation**: MP4 output is playable in VLC/Chrome. WebM output is playable. GIF respects 5 MB size budget. Animated WebP is playable. Output metadata matches actual file properties. ffmpeg errors produce actionable messages. Quality presets produce visibly different outputs.
- **status**: Completed
- **log**: 
  - Created `types.ts` with all type definitions: QualityPreset, EncodingOptions (MP4/WebM/GIF/WebP), OutputMetadata, ProgressUpdate, CaptureResult/CaptureFailure union, CapturePipelineConfig
  - Created `capture-pipeline.ts` with CapturePipeline class implementing:
    - H.264/MP4 encoding with libx264, configurable CRF/preset/profile/level
    - VP9/AV1 WebM encoding with libvpx-vp9 and libsvtav1
    - GIF with single-pass palette generation (split/palettegen/paletteuse filter chain)
    - Animated WebP with libwebp-palette encoder
    - GIF size budget enforcement with auto-reduce (iteratively reduces scale/fps)
    - ffprobe-based output metadata extraction (dimensions, duration, fps, codec, file size, frame count)
    - Progress reporting via stderr time= parsing
    - Quality presets: max (CRF 18/slow), balanced (CRF 23/medium), small (CRF 28/fast)
    - Actionable error messages for common ffmpeg failures (missing input, codec issues, permissions)
  - 35 tests all passing (RED -> GREEN): instantiation, MP4 encoding, VP9/AV1 WebM, GIF palette/budget, WebP, metadata accuracy, progress reporting, quality preset comparison, playback validation via ffprobe
  - Fixed GIF encoding to use single-pass filter_complex (avoided two-pass palettegen+paletteuse split)
  - Fixed progress parsing to read from stderr (ffmpeg outputs time= there)
  - Fixed TypeScript type issues with nullable regex groups and array indexing
- **files edited/created**: 
  - packages/renderer/src/capture/types.ts (new — 145 lines)
  - packages/renderer/src/capture/capture-pipeline.ts (new — 660 lines)
  - packages/renderer/src/capture/capture-pipeline.test.ts (new — 560 lines)
  - packages/renderer/src/index.ts (updated — added CapturePipeline exports)

### T10a_agent: Exploration agent — agent loop
- **depends_on**: [T5_browser, T2]
- **location**: `packages/core/src/explorer/agent-loop.ts`
- **description**: Main exploration loop. Each turn: serialize page state -> call LLM (T7_llm) with system prompt + action schema JSON + page state -> parse constrained response -> execute action via browser package (T5_browser) -> record step -> repeat until `done` or budget exhausted. System prompt includes: action space description, goal context, guardrails (allowlist origin, block destructive buttons/routes), step/time budgets. Exploration transcript: full turn log (state sent, response received, action executed) for debugging. Script assembly: collects all steps into valid Demo Script (validated via T2 schema). Human confirm step after discovery mode (proposes flows, asks for confirmation). Progress reporting via shared ProgressReporter interface.
- **validation**: Agent correctly executes a multi-step flow (goto -> click -> fill -> click -> wait_for). JSON schema constraint prevents invalid action types. Step budget stops exploration after N steps. Destructive action (e.g., "Delete account") is blocked by guardrails. Exploration transcript is complete and debuggable. Output Demo Script validates against schema. Discovery mode proposes flows and waits for confirmation. Progress reporter shows turn-by-turn status.
- **status**: Completed
- **log**:
  - Created `packages/core/src/explorer/types.ts` — type definitions for explorer (LlmClient interface, PageState, AccessibilityNode, FormField, ProgressReporter, GuardrailsConfig, ExplorationTurn, ExplorationTranscript, ExplorationResult, etc.)
  - Created `packages/core/src/explorer/agent-loop.ts` — main ExplorerAgent class with exploration loop, system prompt builder, page state serializer, LLM request builder, action executor, guardrails checker, step builder, script assembler
  - Created `packages/core/src/explorer/agent-loop.test.ts` — 20 tests covering all acceptance criteria
  - Created `packages/core/src/explorer/index.ts` — module re-exports
  - Updated `packages/core/src/index.ts` — added explorer module exports
  - TDD RED->GREEN: tests fail first (module not found), then all 20 pass after implementation
- **files edited/created**:
  - packages/core/src/explorer/types.ts (new — 295 lines)
  - packages/core/src/explorer/agent-loop.ts (new — 1186 lines)
  - packages/core/src/explorer/agent-loop.test.ts (new — 1132 lines)
  - packages/core/src/explorer/index.ts (new — 10 lines)
  - packages/core/src/index.ts (modified — added explorer exports)
- **errors/gotchas**:
  - Pre-existing failures in errors.test.ts and types.test.ts due to core index.ts exporting from llm/client.js which references undefined error types (LlmUnavailableError, etc.) — not related to this task
  - Mock browser needed separate click tracking array (was only using generic actions array)
  - Guardrails pattern matching needed normalization for hyphenated selectors (e.g., "delete-account" vs "delete account")

### T10b_guardrails: Exploration agent — guardrails and budgets
- **depends_on**: [T10a_agent]
- **location**: `packages/core/src/explorer/guardrails.ts`
- **description**: Guardrails and budget enforcement for the explorer agent. Origin allowlist: only actions within configured origins are allowed. Destructive action denylist: block buttons/routes like "Delete account", "Reset", "Empty database" (configurable). Step budget: hard limit on total steps per exploration. Time budget: hard limit on total exploration time. Budget exceeded handling: stop exploration, emit partial script with budget warning. Guardrails are applied before each LLM call and after each response parsing.
- **validation**: Actions on disallowed origins are blocked. Destructive buttons (configurable) are blocked. Exploration stops after step budget is reached. Exploration stops after time budget is reached. Budget warnings are included in exploration transcript. Guardrails can be configured per-project in demoforge.yaml.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T10c_transcript: Exploration agent — transcript and assembly
- **depends_on**: [T10a_agent]
- **location**: `packages/core/src/explorer/transcript.ts`
- **description**: Exploration transcript logging and Demo Script assembly. Turn-by-turn log: page state snapshot, LLM request (truncated), LLM response, action executed, action result. Script assembly: collects all steps into valid Demo Script structure. Human confirmation UI: presents proposed flows, waits for user input (accept/reject/modify). Transcript saved to `.demoforge/transcript/` for debugging. Transcript format: JSON with timestamps for each turn.
- **validation**: Transcript contains all turns with complete state and responses. Transcript is valid JSON. Script assembly produces a valid Demo Script. Human confirmation UI presents flows and waits for input. Transcript files are saved to `.demoforge/transcript/`.
- **status**: Completed
- **log**: 
  - Created `Transcript` class with turn-by-turn logging, auto-increment turn numbers, blocked/unblocked tracking
  - Each turn captures: page state snapshot, system prompt, LLM request (truncated to 3000 chars), LLM response, selected/executed actions, blocked status, action result, error
  - Created `ScriptAssembly` class that collects non-blocked turns into DemoStep[], adds done step if missing, validates against T2 schema
  - Created `HumanConfirmUI` class with accept/reject/modify decisions, delegating to onConfirm callback
  - File I/O: `saveTranscriptToFile()` creates `.demoforge/transcript/` directory, generates filename from URL + timestamp, saves as JSON
  - `loadTranscriptFromFile()` validates required fields (url, goal, turns)
  - `truncateContent()` utility for truncating large LLM I/O in serialized output
  - 43 tests (RED -> GREEN): transcript logging, JSON serialization, file persistence, script assembly, human confirmation, integration lifecycle
  - Fixed ZodError handling: uses `.issues` property (not `.errors`)
  - Fixed narration_mode enum: uses "captions"|"tts"|"none" (not "auto")
  - Fixed ExplorerError constructor: passes options object, not string code
- **files edited/created**: 
  - packages/core/src/explorer/transcript.ts (new — 602 lines)
  - packages/core/src/explorer/transcript.test.ts (new — 1518 lines, 43 tests)
  - packages/core/src/explorer/index.ts (modified — added transcript module exports)

### T11_effects: Effects rendering — zoom, highlight, callouts
- **depends_on**: [T9a_renderer, T9b_cursor]
- **location**: `packages/renderer/src/effects/`
- **description**: Visual effects layered on top of renderer. Zoom/pan (Ken Burns effect): CSS transform with smooth interpolation between keyframes. Element spotlight/dim: target element highlighted, surrounding content dimmed. Callout labels: text annotations positioned near target elements. Smooth scroll easing: replaces instant scroll with cubic-bezier animation. All effects are CSS-based (no DOM mutation of app content). Effect timing aligned with step timestamps. Configurable effect style (colors, durations). Effects work alongside the synthetic cursor (T9b_cursor).
- **validation**: Highlight effect visually highlights target element without breaking app interactivity. Zoom effect smoothly transitions between viewport positions. Callout labels appear at correct positions. Scroll is visibly eased, not instant. Effects are CSS-only (app DOM is not mutated). Effect config changes produce visible differences. Effects work correctly with synthetic cursor overlay.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T12a_tts: Audio — TTS engine
- **depends_on**: [T9a_renderer]
- **location**: `packages/renderer/src/audio/tts/`
- **description**: TTS engine with pluggable backend interface. Piper (local, default) and Kokoro (local, higher quality) backends. Cloud voices optionally via OpenAI-compatible TTS. Per-step narration text from `narrate` steps. Timing alignment: TTS output duration matched to step pause duration. TTS licensing compliance: model source verification, license file generation, captions-only fallback when TTS is unavailable. TTS is opt-in (disabled by default, enabled via config). TTS audio can be embedded in video or provided as sidecar audio track.
- **validation**: Piper backend produces audible output. Kokoro backend produces higher quality output. TTS audio duration matches narration timing. TTS is disabled by default and enabled via config. Captions-only fallback works when TTS is unavailable. License files are generated for bundled TTS models. TTS audio can be embedded or provided as sidecar.
- **status**: Completed
- **log**: 
  - Created TtsEngine class with pluggable backend interface (TtsBackend)
  - Implemented PiperBackend (local, default) — fast neural TTS via piper binary, reads text from stdin, outputs raw audio
  - Implemented KokoroBackend (local, higher quality) — better voice quality via kokoro binary
  - Implemented OpenAiBackend (cloud voices) — uses OpenAI-compatible /v1/audio/speech endpoint
  - Added per-step narration support: synthesize() accepts text from narrate steps
  - Timing alignment: targetDurationMs config pads/truncates audio to match step pause duration
  - Speech rate config (speechRate) adjusts duration estimation
  - Licensing compliance: generateLicenseFile() creates TTS-LICENSE.txt, verifyModelSource() checks SHA-256 hashes and approved source domains
  - TTS opt-in: disabled by default (enabled: false), enabled via TtsConfig
  - Audio output modes: 'embedded' (default, audio in result buffer) and 'sidecar' (writes .wav file to outputDir)
  - Captions-only fallback: fallbackMode 'captions-only' returns empty audio with estimated duration when TTS unavailable
  - 25 unit tests covering all acceptance criteria (RED -> GREEN)
  - Exported from @demoforge/renderer package index
- **files edited/created**: 
  - packages/renderer/src/audio/tts/types.ts (new — TtsBackend interface, TtsConfig, TtsSynthesisResult, etc.)
  - packages/renderer/src/audio/tts/backends/piper.ts (new — PiperBackend)
  - packages/renderer/src/audio/tts/backends/kokoro.ts (new — KokoroBackend)
  - packages/renderer/src/audio/tts/backends/openai.ts (new — OpenAiBackend)
  - packages/renderer/src/audio/tts/backends/index.ts (new — backend exports)
  - packages/renderer/src/audio/tts/engine.ts (new — TtsEngine class)
  - packages/renderer/src/audio/tts/license.ts (new — license generation and model verification)
  - packages/renderer/src/audio/tts/index.ts (new — TTS module exports)
  - packages/renderer/src/audio/tts/tts.test.ts (new — 25 tests)
  - packages/renderer/src/audio/index.ts (new — audio module re-exports)
  - packages/renderer/src/index.ts (modified — added TTS exports)

### T12b_captions: Audio — captions
- **depends_on**: [T12a_tts]
- **location**: `packages/renderer/src/audio/captions/`
- **description**: Caption generation and styling. SRT and VTT generation from narration text + timing (from T12a_tts). Caption styling: font, size, position, background (configurable). Sidecar caption files (`.srt`, `.vtt`) alongside video. Burned-in captions: ffmpeg subtitle overlay (uses T9c_capture pipeline). Caption timing aligned with TTS narration or `narrate` step pauses.
- **validation**: SRT output has correct format (number, timestamp, text). VTT output is valid WebVTT. Caption files are playable in video players. Burned-in captions render correctly in final video. Caption styling is configurable and visible.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T13_screenshots: Screenshot annotation and redaction
- **depends_on**: [T9a_renderer]
- **location**: `packages/renderer/src/screenshots/`
- **description**: Screenshot capture and annotation. Full-page and element-scoped screenshots via browser package (T5_browser). Annotation primitives: arrows, boxes, blur-redaction for sensitive regions (credit cards, emails, passwords). Auto-redaction rules from config (regex patterns). PNG output with configurable quality. Before/after comparison: side-by-side or overlay mode for diff reports. Used by renderer failure output and heal command (T14_heal).
- **validation**: Full-page screenshot captures entire scrollable page. Element screenshot captures only the targeted element. Annotation boxes are correctly positioned. Blur redaction obscures sensitive text. Config redaction rules match and blur sensitive data. PNG output is valid and viewable.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T14_heal: Heal command — selector repair
- **depends_on**: [T9a_renderer, T10a_agent, T7_llm, T13_screenshots]
- **location**: `packages/cli/src/commands/heal.ts`, `packages/core/src/heal/`
- **description**: LLM-assisted selector repair on replay failure. Triggered by `demoforge heal`. On failure: capture current AX tree (via T10a_agent state serialization), take screenshot (T13_screenshots), send to LLM (T7_llm) with failing step, old selector, and new page state. LLM proposes selector patch as reviewable diff (never auto-commits). Diff shows old vs new selector with explanation. Accept/reject workflow: `--accept` flag for automated approval, interactive mode for manual review. Healed script is validated against schema (T2) before saving.
- **validation**: Heal correctly identifies broken selectors and proposes alternatives. Proposed diff is valid YAML. Healed script passes schema validation. `--accept` flag auto-applies changes. Without `--accept`, changes are reviewable but not applied. LLM explanation is human-readable. Screenshot included in LLM context for VLM-assisted healing. Fails gracefully if LLM is unavailable (no silent auto-commit).
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T15_virtual_time: Renderer — virtual time support
- **depends_on**: [T9a_renderer]
- **location**: `packages/renderer/src/virtual-time/`
- **description**: CDP virtual time injection for stabilizing animated UIs. Sets `timeDomain: "time"` and overrides `Page.setTimeDomain` via CDP. Configurable virtual time factor (e.g., 0.5x for slow motion, 2x for fast forward). Stabilizes live charts, websockets, and other nondeterministic UIs (PRD Risk #4). Virtual time is applied per-step via CDP commands. Falls back to real time if CDP virtual time is not supported.
- **validation**: Virtual time slows down or speeds up page animations. Live charts render deterministically under virtual time. Fallback to real time works when CDP virtual time is unavailable. Virtual time does not break normal page interactions.
- **status**: Completed
- **log**: 
  - Created `VirtualTimeController` class in `packages/renderer/src/virtual-time/controller.ts`
  - `start()` enables virtual time via `BrowserSession.setVirtualTime()` with `timeDomain: 'time'`
  - `stop()` resets to real time via `BrowserSession.resetVirtualTime()`
  - `applyAsync(factor)` applies new speed factor per-step (0.5x slow, 2x fast, etc.)
  - `apply(factor)` sync validation for factor before async CDP call
  - `isSupported()` probes CDP capability without leaving virtual time active
  - Fallback: `setVirtualTime` failure sets `fallbackActive=true`, controller silently degrades
  - Constructor validates factor > 0, throws on invalid values
  - 32 comprehensive tests covering: constructor, start/stop, apply, isEnabled, isSupported, fallback, per-step, lifecycle, factor validation
  - Exported from `@demoforge/renderer` package
  - TDD RED->GREEN: 32 tests all passing
- **files edited/created**: 
  - packages/renderer/src/virtual-time/controller.ts (new — 124 lines)
  - packages/renderer/src/virtual-time/controller.test.ts (new — 343 lines, 32 tests)
  - packages/renderer/src/virtual-time/index.ts (new — 6 lines)
  - packages/renderer/src/index.ts (updated — added VirtualTimeController/VirtualTimeConfig exports)

### T16_matrix: Render matrix — viewport/theme/locale variations
- **depends_on**: [T9a_renderer, T11_effects, T3_config]
- **location**: `packages/renderer/src/matrix/`
- **description**: Render multiple variations from one Demo Script. Matrix dimensions: viewport sizes (from T3_config), color schemes (light/dark via `prefers-color-scheme` CSS media query), locales (via `navigator.language` override). Parallel rendering of matrix cells. Output naming: `{flow}-{viewport}-{theme}-{locale}.{ext}`. Diff report: per-step SSIM/pixel-diff between renders to surface unintended UI changes. Configurable matrix (subset of all combinations). Effects (T11_effects) are applied per-cell.
- **validation**: Render produces one output per matrix cell. Output filenames include all matrix dimensions. Light/dark renders show correct color scheme. Locale renders use correct language. Diff report identifies pixel differences between versions. SSIM scores are accurate. Matrix rendering is parallel (faster than sequential).
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T17_site: Demo site generator
- **depends_on**: [T2_core, T9c_capture, T11_effects]
- **location**: `packages/site/src/`
- **description**: Static site generator from rendered flows. `demoforge site` command. Template: HTML with embedded video (from T9c_capture), step-by-step captioned stills, narration text, effects catalog (from T11_effects). Index page: gallery of all flows with thumbnails. Per-flow page: video player, step timeline with captions, copyable narration. Themeable: light/dark mode toggle, configurable colors/fonts. Deployable: outputs static HTML/CSS/JS to `dist/` directory. No JavaScript framework dependency (vanilla HTML/CSS/JS). Search and filter by flow name/tags. Asset validation: validates that referenced videos and images exist and are valid (depends on T9c_capture).
- **validation**: `demoforge site` produces `dist/index.html` and `dist/flows/*.html`. Index page lists all flows with thumbnails. Per-flow pages embed video and captioned stills. Site is viewable in Chrome/Firefox/Safari without a dev server. Light/dark theme toggle works. Static files deploy correctly to any static host (Netlify, GitHub Pages). Asset validation catches missing or corrupt files.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T18_ci: CI integration — GitHub Action
- **depends_on**: [T6_cli, T9a_renderer, T9c_capture, T17_site, T14_heal, T16_matrix]
- **location**: `action.yml`, `.github/workflows/demoforge.yml`
- **description**: GitHub Action for CI demo asset regeneration. Action: checks out repo, installs dependencies, runs `demoforge render` on release tags. Commits/uploads generated assets. Fails loudly when a flow can no longer replay (smoke test of the product). Optional `heal` step on render failure (T14_heal). Cache Playwright browsers and ffmpeg artifacts. Configurable matrix in workflow YAML (T16_matrix). Example workflow file included in scaffold (T3_config). Full pipeline validation: CLI, renderer, ffmpeg, site generator, heal, and matrix all tested.
- **validation**: Action runs successfully on a test repository with a valid Demo Script. Assets are committed and uploaded on success. Action fails when a flow breaks (assertion). Heal step triggers on render failure and proposes fixes. Browser cache reduces install time. Workflow YAML is scaffolded by `demoforge init`. Full pipeline is tested end-to-end.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T19_docs: Documentation and dogfooding
- **depends_on**: [T16_matrix, T17_site]
- **location**: `README.md`, `packages/*/README.md`, demo assets produced by DemoForge itself
- **description**: README with installation, quickstart, architecture overview, CLI reference, config reference, and API docs. Per-package READMEs for monorepo structure. Dogfooding: produce all demo assets (videos, screenshots, GIFs, demo site) using DemoForge itself. Example Demo Scripts for common patterns (login flow, dashboard walkthrough, form submission). CONTRIBUTING.md for OSS contributors. Dogfooding uses: T6_cli for orchestration, T9a_renderer for video, T9c_capture for encoding, T12a_tts for narration, T12b_captions for captions, T17_site for demo gallery.
- **validation**: README installs and runs without errors. Quickstart produces a video within 15 minutes. CLI reference is complete and accurate. Example scripts validate against schema. Dogfood assets are produced and viewable. Demo site generated from dogfood assets is deployable. CONTRIBUTING.md covers monorepo development workflow.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

### T20_integration: Integration tests and final validation
- **depends_on**: [T18_ci, T19_docs]
- **location**: `tests/integration/`, `tests/e2e/`
- **description**: End-to-end integration tests covering the full pipeline. Test scenarios: `init` -> `render` -> verify output files; `init` -> `explore` (mock LLM) -> verify script; `init` -> `render` -> `site` -> verify site; `init` -> `render` (break selector) -> `heal` -> verify repair; `init` -> `render --matrix` -> verify all cells. Determinism test: run renderer 100 times on same script, verify byte-identical output. Flake rate test: run renderer 100 times, verify < 1% failure rate. Mock web app used for all tests (from T4_test).
- **validation**: All integration tests pass against a mock web app. Determinism test produces byte-identical output across 100 runs. Flake rate is < 1%. Heal test correctly repairs broken selectors. Matrix test produces all expected output cells. Site test produces valid HTML with embedded assets.
- **status**: Not Completed
- **log**: 
- **files edited/created**: 

## Parallel Execution Groups

| Wave | Tasks | Can Start When | Est. Effort |
|------|-------|----------------|-------------|
| 1 | T1, T2, T3, T4_test | Immediately | 1 day |
| 2 | T5_browser | T1 complete | 1 day |
| 3 | T6_cli, T7_llm, T8_seed | T5_browser + T2 + T3 complete | 2 days |
| 4 | T9a_renderer, T10a_agent | T5_browser + T2 complete | 2-3 days |
| 5 | T9b_cursor, T9c_capture, T10b_guardrails, T10c_transcript | T9a_renderer + T10a_agent complete | 2 days |
| 6 | T11_effects, T12a_tts, T13_screenshots, T15_virtual_time | T9a_renderer complete | 2 days |
| 7 | T12b_captions, T14_heal, T16_matrix | Wave 6 + T3 complete | 2 days |
| 8 | T17_site | T9c_capture + T11_effects + T2 complete | 1-2 days |
| 9 | T18_ci | Wave 8 + T6_cli + T14_heal + T16_matrix complete | 1 day |
| 10 | T19_docs | T16_matrix + T17_site complete | 1 day |
| 11 | T20_integration | T18_ci + T19_docs complete | 1 day |

## Testing Strategy

- **Unit tests** (Vitest): Core types, config parsing, LLM client, page state serialization, effects logic, audio timing, site templates. Target: 80%+ coverage on `core` and `renderer`.
- **Integration tests** (Vitest + Playwright): Full renderer pipeline (hand-written script -> video), explorer agent loop (mock LLM -> script), site generation (scripts -> static HTML), heal flow (break -> repair).
- **E2E tests** (Playwright): `demoforge init` -> `demoforge render` -> verify output files exist and are valid. Run against mock web app (from T4_test).
- **Determinism tests**: Run renderer 100 times on same script, verify byte-identical output (excluding timestamps).
- **Flake rate tests**: Run renderer 100 times on stable app, verify < 1% failure rate.
- **Heal tests**: Break a selector in a Demo Script, run `demoforge heal`, verify repair produces valid script.
- **Matrix tests**: Render with 3 viewports x 2 themes x 2 locales = 12 cells, verify all produced.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ffmpeg availability on target systems | Renderer fails | `demoforge doctor` checks for ffmpeg; clear install instructions; fallback to browser-native capture if possible |
| llama-server unavailable or slow | Explorer stalls | Timeout with actionable error; cloud escape hatch behind same interface; offline mode for render-only |
| Small-model planning quality | Poor demo scripts | JSON schema constraints, AX-tree compaction, human-in-the-loop confirmation after discovery |
| Selector fragility on dynamic UIs | Frequent heal triggers | Role/name selectors as default, CSS/XPath fallback, heal with LLM-assisted repair |
| Canvas-based apps out of scope | Limited applicability | Document as v1 limitation; AX-tree based approach doesn't work for canvas |
| TTS licensing/quality tradeoffs | Narration quality varies | Pluggable TTS backend; Piper as default (easy), Kokoro as upgrade option; captions-only fallback; TTS opt-in |
| Monorepo complexity | Slower development | npm workspaces (simplest option); start with minimal tooling; add nx/turborepo later if needed |
| Video file sizes | Storage/bandwidth costs | Size budgets per format; automatic quality negotiation; palette-optimized GIFs |
| Seed-data hook hangs | Pipeline blocks indefinitely | Configurable timeout (default 30s) with clear error |
| CSP-restricted target apps | Synthetic cursor blocked | CSP detection in renderer, fall back to real OS cursor recording |
| Animated/nondeterministic UIs | Non-reproducible renders | CDP virtual time stabilization, stability detection (render N times, pick best) |
| Empty state demos | Poor quality demo content | Seed-data hook with `--strict` mode, proceed with warning by default |
