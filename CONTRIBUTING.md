# Contributing to DemoForge

Thank you for your interest in DemoForge! This document covers the development workflow, code standards, and contribution process for this monorepo.

## Table of Contents

- [Monorepo Structure](#monorepo-structure)
- [Development Setup](#development-setup)
- [Building and Testing](#building-and-testing)
- [Adding a New Package](#adding-a-new-package)
- [Code Style](#code-style)
- [Commit Guidelines](#commit-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)

---

## Monorepo Structure

DemoForge uses npm workspaces for its monorepo. All packages share a single `package.json` at the root and are built together with TypeScript project references.

```
demo-forge/
├── package.json              # Root: workspaces, shared scripts
├── tsconfig.json             # Shared TS config with path aliases
├── eslint.config.mjs         # ESLint flat config
├── vitest.config.ts          # Vitest test runner config
├── .prettierrc               # Prettier formatting
├── packages/
│   ├── core/                 # @demoforge/core — types, schemas, config, LLM, explorer
│   ├── browser/              # @demoforge/browser — Playwright abstraction
│   ├── cli/                  # @demoforge/cli — CLI commands
│   ├── renderer/             # @demoforge/renderer — replay, capture, effects, TTS
│   ├── site/                 # @demoforge/site — static site generator
│   └── test-utils/           # @demoforge/test-utils — mock LLM server, fixtures
├── test/                     # E2E tests, mock web app, fixtures
├── examples/                 # Example demo scripts
└── dist/                     # Build output
```

### Package Dependencies

```
cli ──► core, browser, renderer, site
renderer ──► core, browser
site ──► core, renderer
browser ──► core
core ──► (none)
test-utils ──► (none, dev-only)
```

---

## Development Setup

### Prerequisites

- Node.js 20+ (LTS)
- npm 9+
- ffmpeg (for renderer tests)
- Playwright browsers (`npx playwright install`)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/your-org/demo-forge.git
cd demo-forge

# Install all dependencies
npm install

# Build all packages
npm run build

# Run the full test suite
npm test

# Start TypeScript watch mode
npm run watch
```

---

## Building and Testing

### Build

```bash
# Build all packages
npm run build

# Build a single package
tsc --build packages/core

# Watch mode (rebuilds on changes)
npm run watch
```

The root `build` script orchestrates all packages via explicit `tsc --build` paths. Packages must be built in dependency order: `core → browser → cli, renderer → site`.

### Test

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests for a specific package
npx vitest run packages/core

# Run with coverage
npx vitest run --coverage
```

Tests are organized per-package under `packages/*/src/*.test.ts`. E2E tests live in `test/e2e/`.

### Lint and Format

```bash
# Lint all packages
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format all files
npm run format

# Check formatting without changes
npm run format:check
```

---

## Adding a New Package

### 1. Create the package directory

```bash
mkdir packages/new-pkg
```

### 2. Add `package.json`

```json
{
  "name": "@demoforge/new-pkg",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "watch": "tsc --build --watch"
  },
  "dependencies": {
    "@demoforge/core": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0"
  }
}
```

### 3. Add `tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "paths": {
      "@demoforge/core": ["../../packages/core/src/index.ts"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist"]
}
```

### 4. Create entry point

```bash
echo 'export * from "./module.js";' > packages/new-pkg/src/index.ts
```

### 5. Update root configuration

- Add the package to `workspaces` in root `package.json` (if not using `packages/*`)
- Add the package to `build` and `watch` scripts in root `package.json`
- Add the package to `tsconfig.json` project references
- Add path aliases for `@demoforge/new-pkg` in root `tsconfig.json`
- Add resolve aliases in `vitest.config.ts`

### 6. Build and test

```bash
npm run build
npm test
```

---

## Code Style

DemoForge uses Prettier for formatting and ESLint for linting. The configuration is at the root level and applies to all packages.

### Formatting Rules

- Semicolons: always
- Trailing commas: es5
- Single quotes
- 100 character line width
- 2-space indentation

### TypeScript Standards

- Strict mode enabled (`"strict": true`)
- ES2022 target
- Node16 module resolution
- No implicit any (`"noImplicitAny": true`)
- Strict null checks (`"strictNullChecks": true`)

### Naming Conventions

- **Classes**: PascalCase (`BrowserSession`, `CapturePipeline`)
- **Functions**: camelCase (`loadConfig`, `validateDemoScript`)
- **Interfaces**: PascalCase (`Config`, `DemoScript`)
- **Types**: PascalCase (`DemoStep`, `NarrationMode`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_LLM`, `CONFIG_FILENAMES`)
- **Private fields**: leading underscore (`this._logger`)
- **Exports**: named exports preferred over default exports

### Import Order

1. Node.js built-in modules
2. Third-party packages
3. Relative imports (`../`, `./`)
4. `@demoforge/*` scoped packages

Within each group, sort alphabetically.

---

## Commit Guidelines

DemoForge uses conventional commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

| Type | Description |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `test` | Adding or updating tests |
| `refactor` | Code refactoring |
| `chore` | Build/tooling changes |
| `ci` | CI configuration changes |

### Examples

```
feat(cli): add heal command for selector repair
fix(renderer): fix global timeout not checking between steps
docs(readme): add CLI reference section
test(core): add 25 seed hook tests
refactor(browser): extract selector resolution to helper
chore(deps): update vitest to 1.2.0
```

---

## Submitting a Pull Request

### Before You Start

1. Create a feature branch from `main`:
   ```bash
   git checkout main
   git pull
   git checkout -b feat/my-feature
   ```

2. Make your changes, following the code style guidelines above.

3. Write tests for new functionality. Run the full test suite:
   ```bash
   npm test
   ```

4. Build and verify no TypeScript errors:
   ```bash
   npm run build
   ```

5. Lint and format:
   ```bash
   npm run lint:fix
   npm run format
   ```

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated (README, package READMEs)
- [ ] Commit messages follow conventional commits
- [ ] PR title and description are clear and descriptive

### PR Description Template

```markdown
## Summary

Brief description of the changes.

## Changes

- Added/modified `<file>`: `<description>`
- Added/modified `<file>`: `<description>`

## Testing

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Manual testing steps (if applicable)

## Related Issues

Closes #<issue-number>
```

---

## Development Workflow Tips

### Watching for Changes

```bash
# Start TypeScript watch mode in a terminal
npm run watch

# In another terminal, run tests
npm run test:watch
```

### Debugging a Specific Package

```bash
# Build only core package
tsc --build packages/core

# Run tests for core only
npx vitest run packages/core

# Open a package in VS Code
code packages/core
```

### Common Issues

**TypeScript path alias resolution failing:**
Make sure `tsconfig.json` in the root has the correct `paths` entries and that `tsc --build` is run after any path changes.

**Tests failing with module not found:**
Run `npm run build` to ensure all packages are compiled. Vitest resolves `@demoforge/*` imports to `dist/` files.

**Playwright browser not found:**
Run `npx playwright install chromium` to install the required browser.

---

## Getting Help

- Open an issue on GitHub for bugs or feature requests
- Check existing issues before opening a new one
- Join the discussion in pull requests
