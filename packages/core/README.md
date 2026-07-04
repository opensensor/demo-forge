# @demoforge/core

Core types, schemas, configuration, and utilities for DemoForge.

## Package Contents

| Module | Description |
|---|---|
| `types` | TypeScript type definitions: `DemoScript`, `DemoStep`, `Selector`, `Effect`, `Viewport`, `RenderMatrix`, and type guards |
| `schema` | Zod validation schemas for Demo Script JSON/YAML |
| `errors` | Error hierarchy: `DemoForgeError` base class with `ValidationError`, `RenderError`, `ExplorerError`, `HealError`, `ConfigError`, `LlmUnavailableError`, `LlmTimeoutError`, `LlmApiError`, `SeedError` |
| `llm` | OpenAI-compatible LLM client with JSON schema response_format, token counting, and retry logic |
| `config` | `demoforge.yaml` loader and validator with `loadConfig()` and `initConfig()` |
| `explorer` | LLM-powered exploration agent loop with guardrails and transcript logging |
| `seed` | Seed-data hook executor with timeout, retry, and failure mode support |
| `heal` | LLM-assisted selector repair engine |
| `logger` | Structured logger with levels: silent, error, info, warn, debug |

## Installation

This package is part of the DemoForge monorepo. Install via the workspace:

```bash
npm install
npm run build
```

Then import in your code:

```typescript
import {
  validateDemoScript,
  loadConfig,
  ExplorerAgent,
  LlmClient,
  runSeedHook,
  healStep,
} from "@demoforge/core";
```

## Usage

### Validate a Demo Script

```typescript
import { validateDemoScript } from "@demoforge/core";

const script = {
  demo: "my-demo",
  title: "My Demo",
  viewport: { width: 1280, height: 720, scale: 1 },
  narration_mode: "none",
  steps: [
    { goto: "https://example.com" },
    { click: { role: "button", name: "Sign Up" } },
    { done: true },
  ],
};

const result = validateDemoScript(script);
if (!result.success) {
  console.error("Invalid script:", result.error);
}
```

### Load Configuration

```typescript
import { loadConfig, initConfig } from "@demoforge/core";

// Load from CWD or parent directories
const config = await loadConfig();

// Initialize a new project
await initConfig("./my-project");
```

### LLM Client

```typescript
import { LlmClient, plannerConfig } from "@demoforge/core";

const llm = new LlmClient({
  baseURL: "http://localhost:8080",
  model: "llama-3.2-3b-instruct",
  timeout: 30000,
  maxRetries: 2,
});

const response = await llm.sendRequest([{ role: "user", content: "Click the login button" }], plannerConfig);
```

### Explorer Agent

```typescript
import { ExplorerAgent, Guardrails } from "@demoforge/core";

const guardrails = Guardrails.fromConfig(config);
const agent = new ExplorerAgent({
  browser,
  llmClient: llm,
  guardrails,
  goal: "Show the user onboarding flow",
});

const result = await agent.explore("https://example.com");
```

### Heal Engine

```typescript
import { healStep, applyPatches, extractFailingStep } from "@demoforge/core";

const failingStep = extractFailingStep(script, stepIndex, error, url);
const result = await healStep({
  script,
  browser,
  llmClient: llm,
  failingStep,
  outputDir: ".demoforge",
});
```

## Exports

```typescript
// Types
export type { DemoScript, DemoStep, Viewport, Selector, Effect, NarrationMode, ActionType }
export type { ViewportConfig, RenderMatrix, RenderCell }
export type { LLMConfig, Config, SeedConfig, ExplorerConfig, RenderConfig }
export type { PageState, AccessibilityNode, GuardrailsConfig, ExplorationResult }
export type { FailingStep, HealConfig, HealResult, SelectorPatch }
export type { LogLevel, LogEntry, LoggerOptions }
export type { LlmClientConfig, ModelConfig, TokenCount }

// Schemas
export { demoScriptSchema, demoStepSchema, validateDemoScript }

// Errors
export { DemoForgeError, ValidationError, RenderError, ExplorerError, HealError }
export { ConfigError, LlmUnavailableError, LlmTimeoutError, LlmApiError, SeedError }

// LLM
export { LlmClient, TokenCounter, plannerConfig, copywriterConfig }

// Config
export { defaults, loadConfig, initConfig }

// Explorer
export { ExplorerAgent, Guardrails }
export type { ExplorerLlmClient, ExplorerAgentConfig, ProgressReporter }

// Seed
export { runSeedHook }

// Heal
export { healStep, applyPatches, extractFailingStep }

// Logger
export { createLogger, createSilentLogger, createDebugLogger }
```

## Dependencies

- `zod` — Schema validation
- `js-yaml` — YAML parsing for config

## Tests

```bash
npx vitest run packages/core
```

96+ tests covering types, schemas, errors, config, LLM client, explorer agent, seed hooks, and heal engine.
