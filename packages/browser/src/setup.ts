/**
 * DemoForge browser package — browser setup utilities.
 *
 * Provides static methods for installing Playwright browsers and configuring
 * xvfb for headless CI environments.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Browser Installation ───────────────────────────────────────────────────

export interface InstallOptions {
  /** Browser families to install: chromium, firefox, webkit. Default: all. */
  browsers?: Array<'chromium' | 'firefox' | 'webkit'>;
  /** Skip system dependencies installation. Default: false. */
  skipDeps?: boolean;
  /** Force reinstall even if already installed. Default: false. */
  force?: boolean;
}

export class BrowserSetup {
  /**
   * Install Playwright browsers and their system dependencies.
   *
   * @param options - Installation options
   * @returns Promise resolving when installation is complete
   */
  static async install(options: InstallOptions = {}): Promise<void> {
    const browsers = options.browsers ?? ['chromium', 'firefox', 'webkit'];

    console.log('Installing Playwright browsers...');

    const browserArgs = browsers.map((b) => b).join(' ');
    const forceFlag = options.force ? '--force' : '';
    // --with-deps installs system dependencies alongside the browsers;
    // skipDeps:true installs browsers only.
    const depsFlag = options.skipDeps ? '' : '--with-deps';

    try {
      execSync(`npx playwright install ${browserArgs} ${forceFlag} ${depsFlag}`, {
        stdio: 'inherit' as never,
        shell: true as never,
      } as never);
    } catch {
      // --with-deps and --force may not be supported in all versions
      // Fall back to basic install
      try {
        execSync(`npx playwright install ${browserArgs}`, {
          stdio: 'inherit' as never,
          shell: true as never,
        } as never);
      } catch (fallbackError) {
        console.error('Failed to install Playwright browsers.');
        console.error('Try running manually: npx playwright install', browserArgs);
        throw fallbackError;
      }

      if (!options.skipDeps) {
        console.warn(
          'Browsers installed without system dependencies. ' +
            'You may need to run: npx playwright install-deps',
        );
      }
    }

    console.log('Browser installation complete.');
  }

  /**
   * Check if Playwright browsers are installed.
   *
   * Scans the Playwright browsers cache for any revision of the requested
   * browser family (e.g. `chromium-*`), so it does not depend on a specific
   * pinned revision number.
   *
   * @param browser - Browser family to check. Default: chromium.
   * @returns true if the browser is installed
   */
  static isBrowserInstalled(browser: 'chromium' | 'firefox' | 'webkit' = 'chromium'): boolean {
    const cacheHome =
      process.env.PLAYWRIGHT_BROWSERS_PATH ??
      join(process.env.HOME ?? '/tmp', '.cache', 'ms-playwright');

    if (!existsSync(cacheHome)) {
      return false;
    }

    const prefixes: Record<string, string[]> = {
      chromium: ['chromium-', 'chromium_headless_shell-'],
      firefox: ['firefox-'],
      webkit: ['webkit-'],
    };

    const wanted = prefixes[browser] ?? [];

    let entries: string[];
    try {
      entries = readdirSync(cacheHome);
    } catch {
      return false;
    }

    return entries.some(
      (entry) =>
        wanted.some((prefix) => entry.startsWith(prefix)) &&
        // Playwright writes this marker once a browser download finishes.
        existsSync(join(cacheHome, entry, 'INSTALLATION_COMPLETE')),
    );
  }

  /**
   * Check if all required browsers are installed.
   *
   * @returns Object with browser names as keys and boolean values
   */
  static checkAllInstalled(): Record<string, boolean> {
    return {
      chromium: this.isBrowserInstalled('chromium'),
      firefox: this.isBrowserInstalled('firefox'),
      webkit: this.isBrowserInstalled('webkit'),
    };
  }

  // ─── xvfb Configuration ─────────────────────────────────────────────────

  /**
   * Check if xvfb is available and configured.
   *
   * @returns true if xvfb-run is available
   */
  static isXvfbAvailable(): boolean {
    const result = spawnSync('which', ['xvfb-run'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.status === 0 && result.stdout.trim().length > 0;
  }

  /**
   * Configure DISPLAY for an already-running X display.
   *
   * This does NOT start an Xvfb server. If the given display is reachable
   * (e.g. an Xvfb server started externally), DISPLAY is set and the display
   * string is returned. Otherwise returns null. To run a command under a
   * temporary Xvfb server, use runWithXvfb() instead.
   *
   * @param display - X display number to check. Default: 99.
   * @returns The DISPLAY value in use (e.g., ":99"), or null if no display is available
   */
  static configureXvfb(display: number = 99): string | null {
    if (!this.isXvfbAvailable()) {
      console.warn(
        'xvfb-run not found. Install it with: apt-get install xvfb (Debian/Ubuntu) ' +
          'or yum install xorg-x11-server-Xvfb (RHEL/CentOS)',
      );
      return null;
    }

    const displayStr = `:${display}`;

    // Check if the display is already reachable
    const checkResult = spawnSync('xdpyinfo', ['-display', displayStr], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000 as number,
    });

    if (checkResult.status === 0) {
      // Display already available
      process.env.DISPLAY = displayStr;
      return displayStr;
    }

    // No reachable display; do not claim one is running.
    return null;
  }

  /**
   * Run a command under Xvfb.
   *
   * @param command - Command to run
   * @param args - Command arguments
   * @returns Exit code
   */
  static runWithXvfb(command: string, args: string[] = []): number {
    if (!this.isXvfbAvailable()) {
      console.error('xvfb-run not available. Running without Xvfb.');
      const result = spawnSync(command, args, {
        stdio: 'inherit',
      });
      return result.status ?? 1;
    }

    const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', command, ...args], {
      stdio: 'inherit',
    });

    return result.status ?? 1;
  }

  /**
   * Check if running in a CI environment.
   *
   * @returns true if CI environment detected
   */
  static isCI(): boolean {
    return (
      process.env.CI === 'true' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.CI_NAME !== undefined ||
      process.env.CONTINUOUS_INTEGRATION === 'true'
    );
  }

  /**
   * Get recommended launch configuration for the current environment.
   *
   * Returns headless mode with xvfb for CI, headed mode for local development.
   *
   * @returns Configuration object for BrowserLaunchOptions
   */
  static getRecommendedConfig(): {
    headless: boolean;
    headed: boolean;
    args: string[];
  } {
    if (this.isCI()) {
      return {
        headless: true,
        headed: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      };
    }

    return {
      headless: false,
      headed: true,
      args: [],
    };
  }

  // ─── Environment Setup ──────────────────────────────────────────────────

  /**
   * Setup environment for headless browser testing.
   *
   * Configures xvfb if available, sets DISPLAY, and returns the config.
   */
  static setupHeadlessEnvironment(): {
    display: string | null;
    config: { headless: boolean; headed: boolean; args: string[] };
  } {
    const config = this.getRecommendedConfig();
    let display: string | null = null;

    if (config.headless && this.isCI()) {
      display = this.configureXvfb();
    }

    return { display, config };
  }

  /**
   * Write a Playwright config file for CI testing.
   *
   * @param outputPath - Path to write the config file
   * @param browsers - Browsers to include in the config
   */
  static writeCiConfig(
    outputPath: string,
    browsers: Array<'chromium' | 'firefox' | 'webkit'> = ['chromium'],
  ): void {
    const projectsLine = JSON.stringify(
      browsers.map((b) => ({ name: b, use: { browserName: b } })),
      null,
      2,
    );
    const config = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: ${projectsLine},
});
`;

    const dir = join(outputPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outputPath, config);
  }
}
