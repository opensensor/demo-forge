/**
 * DemoForge browser package — BrowserSession class.
 *
 * Encapsulates all Playwright usage. This is the ONLY package that imports
 * playwright directly. All other packages use this abstraction.
 */

import { chromium, firefox, webkit } from 'playwright';
import type { CDPSession } from 'playwright';

import type {
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
  PlaywrightBrowser,
  PlaywrightContext,
  PlaywrightPage,
} from './types.js';

import { resolveSelector } from './types.js';

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
};

export { resolveSelector };

// ─── BrowserSession ─────────────────────────────────────────────────────────

export class BrowserSession {
  private _browser: PlaywrightBrowser | null = null;
  private _context: PlaywrightContext | null = null;
  private _page: PlaywrightPage | null = null;
  private _cdpSession: CDPSession | null = null;
  private _cdpSessionPage: PlaywrightPage | null = null;
  private _screencastActive = false;
  private _options: Required<Omit<BrowserLaunchOptions, 'recordVideo' | 'forbidHostDisplay'>>;
  private _recordVideo: BrowserLaunchOptions['recordVideo'];
  private _forbidHostDisplay: boolean;
  private _videoPath: string | null = null;

  constructor(options: BrowserLaunchOptions = {}) {
    this._recordVideo = options.recordVideo;
    this._forbidHostDisplay = options.forbidHostDisplay ?? false;
    this._options = {
      browser: options.browser ?? 'chromium',
      headed: options.headed ?? true,
      headless: options.headless ?? false,
      cdps: options.cdps ?? true,
      cdpPort: options.cdpPort ?? 0,
      cdpEndpoint: options.cdpEndpoint ?? '',
      viewport: options.viewport ?? { width: 1280, height: 720 },
      args: options.args ?? [],
      slowMo: options.slowMo ?? 0,
      timeout: options.timeout ?? 30000,
      persistent: options.persistent ?? false,
    };
  }

  // ─── Properties ───────────────────────────────────────────────────────

  get browser(): PlaywrightBrowser | null {
    return this._browser;
  }

  get context(): PlaywrightContext | null {
    return this._context;
  }

  get page(): PlaywrightPage | null {
    return this._page;
  }

  get isRunning(): boolean {
    return this._browser !== null;
  }

  get screencastActive(): boolean {
    return this._screencastActive;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async launch(): Promise<this> {
    if (this._browser) {
      return this;
    }

    this._assertHostDisplayPolicy();

    const browserType = this._getBrowserType();
    const launchArgs = this._buildLaunchArgs();

    if (this._options.cdpEndpoint) {
      this._browser = await browserType.connect({
        wsEndpoint: this._options.cdpEndpoint,
        timeout: this._options.timeout,
      });
    } else if (this._options.cdpPort) {
      const endpoint = `http://localhost:${this._options.cdpPort}`;
      this._browser = await browserType.connectOverCDP(endpoint);
    } else {
      this._browser = await browserType.launch(launchArgs);
    }

    await this._createContext();
    await this._createPage();

    return this;
  }

  /**
   * Path to the recorded video file, if `recordVideo` was set.
   * Only populated after `close()` resolves (Playwright finalizes the file
   * when the context closes).
   */
  get videoPath(): string | null {
    return this._videoPath;
  }

  async close(): Promise<void> {
    if (this._screencastActive) {
      await this.stopScreencast();
    }

    if (this._cdpSession) {
      await this._cdpSession.detach().catch(() => {});
      this._cdpSession = null;
      this._cdpSessionPage = null;
    }

    const video = this._page?.video() ?? null;

    if (this._page) {
      this._page = null;
    }

    if (this._context) {
      await this._context.close().catch(() => {});
      this._context = null;
    }

    // The video file is only finalized once the context is closed.
    if (video) {
      this._videoPath = await video.path().catch(() => null);
    }

    if (this._browser) {
      if (!this._options.persistent) {
        await this._browser.close().catch(() => {});
      }
      this._browser = null;
    }
  }

  async goto(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
  ): Promise<void> {
    const page = this._ensurePage();
    await page.goto(url, { waitUntil, timeout: this._options.timeout });
  }

  async reload(): Promise<void> {
    const page = this._ensurePage();
    await page.reload({ timeout: this._options.timeout });
  }

  async waitForNavigation(options?: WaitForOptions): Promise<void> {
    const page = this._ensurePage();
    const timeout = options?.timeout ?? 10000;

    if (options?.selector) {
      await page.waitForSelector(resolveSelector(options.selector), { timeout });
    } else if (options?.text) {
      await (page as any).waitForFunction(
        (text: string) => {
          const body = document.querySelector('body');
          return body ? body.innerText.includes(text) : false;
        },
        options.text,
        { timeout },
      );
    } else if (options?.url) {
      await page.waitForURL(options.url, { timeout });
    } else if (options?.networkIdle) {
      await page.waitForLoadState('networkidle', { timeout });
    } else {
      await page.waitForLoadState('load', { timeout });
    }
  }

  async click(selector: Selector, options?: { force?: boolean }): Promise<void> {
    const page = this._ensurePage();
    await page.click(resolveSelector(selector), {
      timeout: this._options.timeout,
      ...options,
    });
  }

  async hover(selector: Selector): Promise<void> {
    const page = this._ensurePage();
    await page.hover(resolveSelector(selector), { timeout: this._options.timeout });
  }

  async fill(selector: Selector, value: string, options?: FillOptions): Promise<void> {
    const page = this._ensurePage();
    await page.fill(resolveSelector(selector), value, {
      timeout: this._options.timeout,
      ...options,
    });
  }

  async select(selector: Selector, value: string): Promise<void> {
    const page = this._ensurePage();
    await page.selectOption(resolveSelector(selector), value, {
      timeout: this._options.timeout,
    });
  }

  async press(key: string, options?: PressOptions): Promise<void> {
    const page = this._ensurePage();
    await page.keyboard.press(key, {
      delay: options?.delay,
    });
  }

  async scroll(options: ScrollOptions): Promise<void> {
    const page = this._ensurePage();
    const duration = options.duration ?? 300;

    if (options.x !== undefined || options.y !== undefined) {
      await (page as any).evaluate(
        async (args: { x: number; y: number; duration: number }) => {
          const { x, y, duration: dur } = args;
          const startY = window.scrollY;
          const startX = window.scrollX;
          const startTime = performance.now();

          return new Promise<void>((resolve) => {
            const animate = () => {
              const elapsed = performance.now() - startTime;
              const progress = Math.min(elapsed / dur, 1);
              const eased =
                progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

              window.scrollTo(startX + (x - startX) * eased, startY + (y - startY) * eased);

              if (progress < 1) {
                requestAnimationFrame(animate);
              } else {
                resolve();
              }
            };
            requestAnimationFrame(animate);
          });
        },
        { x: options.x ?? 0, y: options.y ?? 0, duration },
      );
    } else if (options.deltaX !== undefined || options.deltaY !== undefined) {
      await (page as any).mouse.wheel(options.deltaX ?? 0, options.deltaY ?? 0);
    } else {
      await (page as any).evaluate(async (dur: number) => {
        const startY = window.scrollY;
        const startTime = performance.now();

        return new Promise<void>((resolve) => {
          const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / dur, 1);
            const eased =
              progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            window.scrollTo(0, startY * (1 - eased));

            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              resolve();
            }
          };
          requestAnimationFrame(animate);
        });
      }, duration);
    }
  }

  async wait_for(options: WaitForOptions): Promise<void> {
    await this.waitForNavigation(options);
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const page = this._ensurePage();
    const opts: Record<string, unknown> = {
      timeout: this._options.timeout,
    };

    if (options?.fullPage) {
      opts.fullPage = true;
    }

    if (options?.type) {
      opts.type = options.type;
    }

    if (options?.quality) {
      opts.quality = options.quality;
    }

    if (options?.omitBackground) {
      opts.omitBackground = true;
    }

    if (options?.element) {
      const element = page.locator(resolveSelector(options.element));
      const buffer = await element.screenshot(opts as Parameters<typeof element.screenshot>[0]);
      if (options?.path) {
        const fs = await import('node:fs');
        fs.writeFileSync(options.path, buffer);
      }
      return buffer;
    }

    const buffer = await page.screenshot(opts as Parameters<typeof page.screenshot>[0]);

    if (options?.path) {
      const fs = await import('node:fs');
      fs.writeFileSync(options.path, buffer);
    }

    return buffer;
  }

  // ─── CDP Utilities ────────────────────────────────────────────────────

  async startScreencast(options?: ScreencastOptions): Promise<void> {
    const cdp = await this._getCDPSession();

    if (this._screencastActive) {
      await this.stopScreencast();
    }

    const screencastOpts: Record<string, unknown> = {
      format: options?.format ?? 'jpeg',
      quality: options?.quality ?? 75,
    };

    if (options?.width && options?.height) {
      screencastOpts.width = options.width;
      screencastOpts.height = options.height;
    }

    if (options?.maxWidthPerSecond) {
      screencastOpts.maxWidthPerSecond = options.maxWidthPerSecond;
    }

    await (cdp as any).send('Page.startScreencast', screencastOpts);
    this._screencastActive = true;
  }

  async stopScreencast(): Promise<void> {
    const cdp = await this._getCDPSession();
    await (cdp as any).send('Page.stopScreencast').catch(() => {});
    this._screencastActive = false;
  }

  /**
   * Control virtual time via CDP `Emulation.setVirtualTimePolicy` (Chromium only).
   *
   * The Chrome DevTools Protocol has no time-scaling "factor"; virtual time is
   * driven by a policy ('advance' | 'pause' | 'pauseIfNetworkFetchesPending')
   * plus an optional budget. Mapping:
   * - `timeDomain: 'realtime'` resumes real-time behavior (policy 'advance').
   * - `timeDomain: 'time'` (default) enables virtual time with
   *   `options.policy` (default 'pauseIfNetworkFetchesPending').
   * - `maxVirtualTime` maps to the CDP `budget` (milliseconds).
   * - `initialVirtualTime` seeds the clock (seconds since epoch).
   * - `factor` has no CDP equivalent and is ignored with a warning.
   *
   * Errors are rethrown (e.g., on non-Chromium browsers where CDP is unavailable).
   */
  async setVirtualTime(options: VirtualTimeOptions): Promise<void> {
    const cdp = await this._getCDPSession();

    if (options.factor !== undefined && options.factor !== 1) {
      console.warn(
        'setVirtualTime: CDP has no virtual time scaling factor; ignoring `factor`. ' +
          "Use `policy`/`maxVirtualTime` (Emulation.setVirtualTimePolicy) instead.",
      );
    }

    if (options.timeDomain === 'realtime') {
      await this.resetVirtualTime();
      return;
    }

    const params: Record<string, unknown> = {
      policy: options.policy ?? 'pauseIfNetworkFetchesPending',
    };
    if (options.maxVirtualTime) {
      params.budget = options.maxVirtualTime;
    }
    if (options.initialVirtualTime !== undefined) {
      params.initialVirtualTime = options.initialVirtualTime;
    }

    await (cdp as any).send('Emulation.setVirtualTimePolicy', params);
  }

  /**
   * Resume normal time progression after setVirtualTime.
   *
   * CDP has no explicit "disable virtual time" command; the closest real
   * behavior is switching the policy to 'advance', which lets virtual time
   * progress continuously like real time. Errors are rethrown.
   */
  async resetVirtualTime(): Promise<void> {
    const cdp = await this._getCDPSession();
    await (cdp as any).send('Emulation.setVirtualTimePolicy', {
      policy: 'advance',
    });
  }

  async executeCDP(command: CDPCommand): Promise<CDPResponse> {
    const cdp = await this._getCDPSession();

    try {
      const result = await (cdp as any).send(command.method, command.params);
      return { result };
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      return {
        error: {
          code: err.code ?? -1,
          message: err.message ?? 'Unknown CDP error',
        },
      };
    }
  }

  // ─── State ────────────────────────────────────────────────────────────

  async getState(): Promise<BrowserState> {
    const page = this._page;

    return {
      url: page ? await page.url() : '',
      title: page ? await page.title() : '',
      viewport: this._options.viewport,
      pageCount: this._context ? this._context.pages().length : 0,
      isRunning: this.isRunning,
    };
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────

  private _getBrowserType(): typeof chromium {
    switch (this._options.browser) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      case 'chromium':
      default:
        return chromium;
    }
  }

  private _buildLaunchArgs(): Parameters<typeof chromium.launch>[0] {
    const args: string[] = [];

    // These flags are Chromium-specific; firefox/webkit reject unknown args.
    if (this._options.browser === 'chromium') {
      args.push(
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      );
      if (this._forbidHostDisplay) {
        args.push('--ozone-platform=headless');
      }
      // --single-process is crash-prone; only enable when explicitly requested.
      if (process.env.DEMOFORGE_SINGLE_PROCESS === '1' ||
          process.env.DEMOFORGE_SINGLE_PROCESS === 'true') {
        args.push('--single-process');
      }
    }

    args.push(...this._options.args);

    return {
      headless: this._options.headless || !this._options.headed,
      slowMo: this._options.slowMo,
      timeout: this._options.timeout,
      args,
    };
  }

  private async _createContext(): Promise<void> {
    if (!this._browser) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    this._context = await this._browser.newContext({
      viewport: this._options.viewport,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      recordVideo: this._recordVideo,
    });
  }

  private _assertHostDisplayPolicy(): void {
    if (!this._forbidHostDisplay) {
      return;
    }

    if (!this._options.headless || this._options.headed) {
      throw new Error(
        'Host display use is forbidden: launch must set headless: true and headed: false.',
      );
    }

    if (this._options.cdpEndpoint || this._options.cdpPort) {
      throw new Error(
        'Host display use is forbidden: external CDP browsers may be attached to a visible display.',
      );
    }
  }

  private async _createPage(): Promise<void> {
    if (!this._context) {
      throw new Error('Browser context not created. Call launch() first.');
    }

    this._page = await this._context.newPage();
  }

  private _ensurePage(): PlaywrightPage {
    if (!this._page) {
      throw new Error('No page available. Call launch() first.');
    }
    return this._page;
  }

  private async _getCDPSession(): Promise<CDPSession> {
    const page = this._ensurePage();

    if (this._cdpSession && this._cdpSessionPage === page) {
      return this._cdpSession;
    }

    // Page changed: detach the stale session before creating a new one.
    if (this._cdpSession) {
      await this._cdpSession.detach().catch(() => {});
      this._cdpSession = null;
      this._cdpSessionPage = null;
    }

    this._cdpSession = await page.context().newCDPSession(page);
    this._cdpSessionPage = page;
    return this._cdpSession;
  }
}
