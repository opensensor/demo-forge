# @demoforge/cli

DemoForge CLI framework built with Commander.js. Provides the `demoforge` command-line interface for orchestrating demo automation.

## Package Contents

| Module | Description |
|---|---|
| `commands/init` | `demoforge init` — scaffold a new project with `demoforge.yaml` |
| `commands/explore` | `demoforge explore <url>` — LLM-powered web app exploration |
| `commands/render` | `demoforge render [flows...]` — render demo scripts into video/assets |
| `commands/site` | `demoforge site` — generate static demo gallery site |
| `commands/doctor` | `demoforge doctor` — check system dependencies |
| `commands/heal` | `demoforge heal [flows...]` — LLM-assisted selector repair |

## Installation

This package is part of the DemoForge monorepo. Install via the workspace:

```bash
npm install
npm run build
```

The CLI is available as `npx demoforge` or after linking:

```bash
npm link
demoforge --help
```

## Commands

### `demoforge init`

```bash
npx demoforge init
npx demoforge init -o ./my-project
```

### `demoforge explore <url>`

```bash
npx demoforge explore http://localhost:3000 --goal "Show the checkout flow"
```

### `demoforge render [flows...]`

```bash
npx demoforge render
npx demoforge render login dashboard --skip-seed
```

### `demoforge site`

```bash
npx demoforge site --output dist --title "My Demos" --theme dark
```

### `demoforge doctor`

```bash
npx demoforge doctor
```

### `demoforge heal [flows...]`

```bash
npx demoforge heal login --step 3 --accept
```

## Global Options

| Option | Short | Description |
|---|---|---|
| `--config <path>` | | Custom config file path |
| `--verbose` | `-v` | Enable debug logging |
| `--quiet` | `-q` | Suppress non-error output |
| `--output <dir>` | | Default output directory |

## Programmatic Usage

```typescript
import {
  createInitCommand,
  createExploreCommand,
  createRenderCommand,
  createSiteCommand,
  createDoctorCommand,
  createHealCommand,
} from "@demoforge/cli";
import { createLogger, loadConfig } from "@demoforge/core";

const logger = createLogger({ level: "info" });
const config = await loadConfig();

const initCmd = createInitCommand(logger);
const exploreCmd = createExploreCommand(logger, config);
const renderCmd = createRenderCommand(logger, config);
const siteCmd = createSiteCommand(logger, config);
const doctorCmd = createDoctorCommand(logger);
const healCmd = createHealCommand(logger, config);
```

## Entry Point

The CLI entry point is `packages/cli/bin/demoforge`. It:

1. Parses shared options (`--config`, `--verbose`, `--quiet`, `--output`) before Commander
2. Creates a logger based on verbosity flags
3. Loads `demoforge.yaml` config once at CLI entry (config injection pattern)
4. Dynamically imports and registers all command modules
5. Handles unknown commands with suggestions
6. Uses `program.exitOverride()` for clean error handling

## Tests

```bash
npx vitest run packages/cli
```

33 tests covering CLI entry point, command modules, config auto-discovery, shared options, and error handling.
