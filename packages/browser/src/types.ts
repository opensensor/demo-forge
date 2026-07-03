/**
 * DemoForge browser package — type definitions.
 */

import type { Browser, BrowserContext, Page } from 'playwright';

// ─── Launch Configuration ───────────────────────────────────────────────────

export interface ViewportConfig {
  width: number;
  height: number;
}

export interface BrowserLaunchOptions {
  /** Browser to launch: chromium, firefox, or webkit. Default: chromium. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Launch headed (visible) browser. Default: true. */
  headed?: boolean;
  /** Launch in headless mode. Overrides headed. Default: false. */
  headless?: boolean;
  /** Enable Chrome DevTools Protocol. Default: true. */
  cdps?: boolean;
  /** CDP port for remote connection. If set, attempts CDP connect instead of local launch. */
  cdpPort?: number;
  /** CDP endpoint URL for remote connection (e.g., ws://localhost:9222). */
  cdpEndpoint?: string;
  /** Browser viewport dimensions. Default: 1280x720. */
  viewport?: ViewportConfig;
  /** Additional browser launch arguments. */
  args?: string[];
  /** Slow down each operation by the specified milliseconds. */
  slowMo?: number;
  /** Timeout for browser launch in milliseconds. Default: 30000. */
  timeout?: number;
  /** Whether to close the browser when the session ends. Default: true. */
  persistent?: boolean;
}

// ─── Selector Types ─────────────────────────────────────────────────────────

export type Selector =
  string | { role: string; name?: string } | { css: string } | { xpath: string };

export function resolveSelector(selector: Selector): string {
  if (typeof selector === 'string') {
    // Try to detect selector type
    if (selector.startsWith('//')) {
      return selector;
    }
    if (selector.startsWith('css:')) {
      return selector;
    }
    if (selector.startsWith('xpath:')) {
      return selector;
    }
    // Check if it looks like a role selector
    if (selector.includes('[role=')) {
      return selector;
    }
    // Default to CSS selector
    return selector;
  }

  if ('role' in selector) {
    if (selector.name) {
      return `[role="${selector.role}"][name="${selector.name}"]`;
    }
    return `[role="${selector.role}"]`;
  }

  if ('css' in selector) {
    return selector.css;
  }

  if ('xpath' in selector) {
    return selector.xpath;
  }

  throw new Error(`Unknown selector type: ${JSON.stringify(selector)}`);
}

// ─── Action Types ───────────────────────────────────────────────────────────

export interface ScrollOptions {
  /** Horizontal scroll position in pixels. */
  x?: number;
  /** Vertical scroll position in pixels. */
  y?: number;
  /** Scroll by this amount horizontally. */
  deltaX?: number;
  /** Scroll by this amount vertically. */
  deltaY?: number;
  /** Scroll duration in milliseconds. Default: 300. */
  duration?: number;
}

export interface WaitForOptions {
  /** Wait for a specific selector to appear. */
  selector?: Selector;
  /** Wait for a specific text to appear. */
  text?: string;
  /** Wait for a URL pattern match. */
  url?: string | RegExp;
  /** Wait for a specific network idle state. */
  networkIdle?: boolean;
  /** Maximum wait time in milliseconds. Default: 10000. */
  timeout?: number;
  /** Amount of time to wait for the condition to be met. Default: 5000. */
  interval?: number;
}

export interface ScreenshotOptions {
  /** Full page screenshot. Default: false. */
  fullPage?: boolean;
  /** Clip to element bounding box. */
  element?: Selector;
  /** Output file path. */
  path?: string;
  /** Screenshot type: 'png' or 'jpeg'. Default: 'png'. */
  type?: 'png' | 'jpeg';
  /** JPEG quality (0-100). Default: 90. */
  quality?: number;
  /** Omit chrome (browser UI) from screenshot. Default: true. */
  omitBackground?: boolean;
}

export interface FillOptions {
  /** Force the action. Default: false. */
  force?: boolean;
}

export interface PressOptions {
  /** Delay between key events in milliseconds. Default: 0. */
  delay?: number;
}

// ─── Screencast ─────────────────────────────────────────────────────────────

export interface ScreencastOptions {
  /** Format: 'jpeg' or 'png'. Default: 'jpeg'. */
  format?: 'jpeg' | 'png';
  /** Screenshot width. Default: browser viewport width. */
  width?: number;
  /** Screenshot height. Default: browser viewport height. */
  height?: number;
  /** Quality for jpeg format (0-100). Default: 75. */
  quality?: number;
  /** Maximum frames per second. Default: 10. */
  maxWidthPerSecond?: number;
}

export interface ScreencastFrame {
  /** Frame data as base64-encoded buffer. */
  data: Buffer;
  /** Offset from the top of the page in CSS pixels. */
  offsetHeight: number;
  /** Offset from the left of the page in CSS pixels. */
  offsetWidth: number;
}

// ─── Virtual Time ───────────────────────────────────────────────────────────

export interface VirtualTimeOptions {
  /** Time domain: 'realtime' or 'time'. Default: 'time'. */
  timeDomain?: 'realtime' | 'time';
  /** Virtual time factor (e.g., 0.5 for slow motion, 2 for fast forward). Default: 1. */
  factor?: number;
  /** Maximum virtual time in milliseconds. Default: 0 (unlimited). */
  maxVirtualTime?: number;
}

// ─── CDP ────────────────────────────────────────────────────────────────────

export interface CDPCommand {
  /** CDP method name (e.g., 'Page.navigate'). */
  method: string;
  /** CDP method parameters. */
  params?: Record<string, unknown>;
}

export interface CDPResponse {
  /** CDP method result. */
  result?: Record<string, unknown>;
  /** CDP error, if any. */
  error?: { code: number; message: string };
}

// ─── Browser State ──────────────────────────────────────────────────────────

export interface BrowserState {
  /** Current URL. */
  url: string;
  /** Page title. */
  title: string;
  /** Current viewport dimensions. */
  viewport: ViewportConfig;
  /** Number of open pages. */
  pageCount: number;
  /** Whether the browser is running. */
  isRunning: boolean;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

export type PlaywrightBrowser = Browser;
export type PlaywrightContext = BrowserContext;
export type PlaywrightPage = Page;
