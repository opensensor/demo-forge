/**
 * DemoForge browser package — BrowserSession class.
 *
 * Encapsulates all Playwright usage. This is the ONLY package that imports
 * playwright directly. All other packages use this abstraction.
 */

import { chromium, firefox, webkit } from 'playwright';

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
  private _screencastActive = false;
  private _options: Required<BrowserLaunchOptions>;

  constructor(options: BrowserLaunchOptions = {}) {
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

  async close(): Promise<void> {
    if (this._screencastActive) {
      await this.stopScreencast();
    }

    if (this._page) {
      this._page = null;
    }

    if (this._context) {
      await this._context.close().catch(() => {});
      this._context = null;
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

  async setVirtualTime(options: VirtualTimeOptions): Promise<void> {
    const cdp = await this._getCDPSession();
    const domain = options.timeDomain ?? 'time';

    // Try to set time domain first (not available in all Chrome versions)
    try {
      await (cdp as any).send('Page.setTimeDomain', {
        timeDomain: domain,
      });
    } catch {
      // setTimeDomain not supported in newer Chrome
    }

    if (domain === 'time' && options.factor !== undefined) {
      const maxVirtualTime = options.maxVirtualTime ?? 0;
      const params: Record<string, unknown> = {
        policy: 'continue',
        initialTimestamp: new Date().toISOString(),
      };
      if (maxVirtualTime) {
        params.virtualTimeBudgetMs = maxVirtualTime;
      }
      if (options.factor !== 1) {
        params.virtualTimeParams = {
          interval: (1 / options.factor) * 1000,
        };
      }
      // Try virtual time policy (not available in all Chrome versions)
      try {
        await (cdp as any).send('Page.setVirtualTimePolicy', params);
      } catch {
        // setVirtualTimePolicy not supported; virtual time injection unavailable
      }
    }
  }

  async resetVirtualTime(): Promise<void> {
    const cdp = await this._getCDPSession();
    // Try to reset time domain (not available in all Chrome versions)
    try {
      await (cdp as any).send('Page.setTimeDomain', {
        timeDomain: 'realtime',
      });
    } catch {
      // setTimeDomain not supported; set virtual time policy to continue with real time
      try {
        await (cdp as any).send('Page.setVirtualTimePolicy', {
          policy: 'continue',
        });
      } catch {
        // setVirtualTimePolicy not supported
      }
    }
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
    return {
      headless: this._options.headless || !this._options.headed,
      slowMo: this._options.slowMo,
      timeout: this._options.timeout,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        ...this._options.args,
      ],
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
    });
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

  private async _getCDPSession(): Promise<import('playwright').CDPSession> {
    const page = this._ensurePage();
    return page.context().newCDPSession(page);
  }
}
