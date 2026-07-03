/**
 * DemoForge browser package — shared Playwright abstraction.
 *
 * Encapsulates all Playwright usage to avoid duplication between renderer
 * and explorer packages.
 */

export { BrowserSession } from './session.js';
export { BrowserSetup } from './setup.js';
export type {
  BrowserLaunchOptions,
  BrowserState,
  CDPCommand,
  CDPResponse,
  FillOptions,
  PressOptions,
  ScreencastFrame,
  ScreencastOptions,
  ScrollOptions,
  Selector,
  ScreenshotOptions,
  WaitForOptions,
  VirtualTimeOptions,
} from './types.js';
export { resolveSelector } from './types.js';
