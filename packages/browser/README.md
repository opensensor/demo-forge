# @demoforge/browser

Shared Playwright abstraction for browser session management, page navigation, and action primitives.

This package encapsulates all Playwright usage to avoid duplication between the renderer and explorer agent packages.

## Package Contents

| Module | Description |
|---|---|
| `session` | `BrowserSession` class with full lifecycle: launch, navigate, interact, screenshot, CDP control |
| `setup` | `BrowserSetup` static class for browser installation, CI detection, and xvfb configuration |
| `types` | TypeScript types for browser configuration, selectors, actions, and CDP interfaces |

## Installation

This package is part of the DemoForge monorepo. Install via the workspace:

```bash
npm install
npm run build
```

Then import in your code:

```typescript
import { BrowserSession, BrowserSetup, resolveSelector } from "@demoforge/browser";
```

## Usage

### Browser Session

```typescript
import { BrowserSession } from "@demoforge/browser";

const browser = new BrowserSession({
  headless: true,
  viewport: { width: 1280, height: 720 },
  browserName: "chromium",
  cdpPort: undefined,
});

await browser.launch();

// Navigate
await browser.goto("https://example.com");
await browser.reload();

// Interact
await browser.click({ role: "button", name: "Sign Up" });
await browser.fill({ target: { role: "textbox", name: "Email" }, value: "user@example.com" });
await browser.press({ key: "Enter" });
await browser.scroll({ amount: 500 });
await browser.hover({ role: "link", name: "Settings" });

// Wait
await browser.waitFor({ text: "Dashboard loaded" });
await browser.waitFor({ selector: { role: "heading", name: "Welcome" }, state: "visible" });

// Screenshot
const screenshot = await browser.screenshot({ fullPage: true });

// CDP
await browser.startScreencast({ format: "png", quality: 80 });
await browser.executeCDP({ command: "Page.getLayoutMetrics" });

// Virtual time
await browser.setVirtualTime({ factor: 0.5, timeDomain: "time" });
await browser.resetVirtualTime();

await browser.close();
```

### Browser Setup

```typescript
import { BrowserSetup } from "@demoforge/browser";

// Install Playwright browsers
await BrowserSetup.install();

// Check if browsers are installed
const installed = await BrowserSetup.isInstalled();

// Configure xvfb for headless CI
const xvfb = BrowserSetup.configureXvfb();
xvfb.run();

// CI detection
const isCI = BrowserSetup.isCI();
```

### Selector Resolution

```typescript
import { resolveSelector } from "@demoforge/browser";

const selector = { role: "button", name: "Submit" };
const resolved = resolveSelector(selector);
// Returns: '[role="button"][name="Submit"]'
```

## BrowserSession API

| Method | Description |
|---|---|
| `launch()` | Launch headed browser with CDP enabled |
| `close()` | Close browser and cleanup |
| `goto(url, settle?)` | Navigate to a URL with settle policy |
| `reload()` | Reload current page |
| `waitForNavigation(options?)` | Wait for navigation to complete |
| `click(selector)` | Click an element |
| `hover(selector)` | Hover over an element |
| `fill(config)` | Fill an input field |
| `select(config)` | Select an option from a dropdown |
| `press(config)` | Press a keyboard key |
| `scroll(config)` | Scroll the page |
| `waitFor(options)` | Wait for text or selector condition |
| `screenshot(options?)` | Capture a screenshot |
| `startScreencast(options?)` | Start CDP screencast |
| `stopScreencast()` | Stop CDP screencast |
| `setVirtualTime(options)` | Set CDP virtual time for animation control |
| `resetVirtualTime()` | Reset virtual time to real time |
| `executeCDP(command)` | Execute a raw CDP command |

## BrowserSetup API

| Method | Description |
|---|---|
| `install()` | Install Playwright browsers |
| `isInstalled()` | Check if browsers are installed |
| `configureXvfb()` | Configure xvfb for headless CI |
| `isCI()` | Detect if running in CI environment |

## Types

```typescript
interface BrowserLaunchOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  browserName?: "chromium" | "firefox" | "webkit";
  cdpPort?: number;
}

interface BrowserState {
  isLaunched: boolean;
  context: BrowserContext | null;
  page: Page | null;
  screencastActive: boolean;
}

type Selector =
  | { role: string; name?: string }
  | { label: string }
  | { text: string }
  | { css: string }
  | { xpath: string }
  | string;
```

## Tests

```bash
npx vitest run packages/browser
```

57 tests covering all API surface and browser operations.
