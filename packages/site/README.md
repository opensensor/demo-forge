# @demoforge/site

Static demo site generator for DemoForge. Generates a responsive HTML gallery from rendered demo flows.

## Package Contents

| Module | Description |
|---|---|
| `site-generator` | `SiteGenerator` class — compiles flows into static HTML/CSS/JS site |
| `templates` | HTML template generation for index and per-flow pages |
| `assets` | Static asset generation (CSS, JS) with theme support |
| `validate` | Asset validation — checks video files, screenshots, and metadata |

## Installation

This package is part of the DemoForge monorepo. Install via the workspace:

```bash
npm install
npm run build
```

Then import in your code:

```typescript
import { SiteGenerator } from "@demoforge/site";
```

## Usage

### Basic Usage

```typescript
import { SiteGenerator } from "@demoforge/site";

const generator = new SiteGenerator("./dist", {
  siteTitle: "My Product Demos",
  searchEnabled: true,
  showTags: true,
  showMetadata: true,
  defaultVideoFormat: "mp4",
  theme: {
    mode: "light",
    colors: {
      primary: "#3b82f6",
      bg: "#ffffff",
      text: "#1e293b",
      cardBg: "#f8fafc",
      cardBorder: "#e2e8f0",
      headerBg: "#f1f5f9",
      footerBg: "#f1f5f9",
      muted: "#64748b",
      accent: "#f59e0b",
    },
    fonts: {
      heading: "Inter, system-ui, sans-serif",
      body: "system-ui, -apple-system, sans-serif",
    },
  },
});

// Add flows
generator.addFlow({
  name: "login-flow",
  title: "User Login Demo",
  demoScript: script,
  outputDir: ".demoforge/output/login-flow",
  tags: ["auth", "forms"],
  thumbnail: "thumbnail.png",
  narration: "The user signs in...",
  videoFiles: {
    mp4: "videos/demo.mp4",
    webm: "videos/demo.webm",
    gif: "videos/demo.gif",
  },
  screenshotFiles: ["screenshots/step-1.png", "screenshots/step-2.png"],
  metadata: { duration: 45, dimensions: { width: 1280, height: 720 } },
  steps: script.steps,
});

// Generate the site
generator.generate();
```

### Asset Validation

```typescript
const result = generator.validateAssets();
console.log(result.valid);       // boolean
console.log(result.errors);      // string[]
console.log(result.warnings);    // string[]
console.log(result.totalFlows);  // number
console.log(result.totalVideos); // number
console.log(result.totalScreenshots); // number
```

### Search and Filter

```typescript
// Search flows by name or description
const results = generator.search("login");

// Filter by tag
const tagged = generator.filterByTag("auth");
```

## Output Structure

```
dist/
├── index.html          # Gallery with search and tag filter
├── flows/
│   ├── login-flow.html  # Per-flow page with video player and timeline
│   ├── dashboard.html
│   └── form-submission.html
├── css/
│   └── site.css         # Responsive, themeable styles
└── js/
    └── site.js          # Theme toggle, search, tag filter, video switching
```

## Features

- **Responsive gallery grid** — auto-layouts for any screen size
- **Search** — filter flows by name and description
- **Tag filtering** — click tags to filter the gallery
- **Light/dark theme** — toggle with localStorage persistence
- **Video format switching** — MP4, WebM, GIF, WebP player
- **Step timeline** — clickable timeline with narration and screenshot thumbnails
- **Copy narration** — one-click copy of narration text
- **Asset validation** — validates video files, screenshots, and metadata
- **Static deployment** — no JavaScript framework, deploys to any static host (Netlify, GitHub Pages, Vercel)

## Types

```typescript
interface FlowConfig {
  name: string;
  title: string;
  demoScript: DemoScript;
  outputDir: string;
  tags?: string[];
  thumbnail?: string;
  narration?: string;
  videoFiles?: Record<string, string>;
  screenshotFiles?: string[];
  metadata?: Record<string, unknown>;
  steps?: DemoStep[];
}

interface SiteConfig {
  siteTitle: string;
  searchEnabled?: boolean;
  showTags?: boolean;
  showMetadata?: boolean;
  defaultVideoFormat?: "mp4" | "webm" | "gif" | "webp";
  theme?: ThemeConfig;
}

interface ThemeConfig {
  mode: "light" | "dark";
  colors?: Record<string, string>;
  fonts?: { heading: string; body: string };
}
```

## Tests

```bash
npx vitest run packages/site
```

37 tests covering site generation, asset validation, template rendering, and theme support.
