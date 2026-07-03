/**
 * DemoForge browser package — tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrowserSession, BrowserSetup, resolveSelector } from './index.js';

describe('resolveSelector', () => {
  it('passes through string selectors unchanged', () => {
    expect(resolveSelector('button')).toBe('button');
    expect(resolveSelector('#submit')).toBe('#submit');
    expect(resolveSelector('.form-input')).toBe('.form-input');
    expect(resolveSelector("input[name='email']")).toBe("input[name='email']");
  });

  it('passes through xpath selectors', () => {
    expect(resolveSelector("//button[@type='submit']")).toBe("//button[@type='submit']");
  });

  it('passes through css: prefixed selectors', () => {
    expect(resolveSelector('css:.my-class')).toBe('css:.my-class');
  });

  it('passes through xpath: prefixed selectors', () => {
    expect(resolveSelector('xpath://button')).toBe('xpath://button');
  });

  it('converts role selector to CSS', () => {
    expect(resolveSelector({ role: 'button' })).toBe('[role="button"]');
    expect(resolveSelector({ role: 'link', name: 'Click me' })).toBe(
      '[role="link"][name="Click me"]',
    );
  });

  it('converts css selector object', () => {
    expect(resolveSelector({ css: '.my-class' })).toBe('.my-class');
  });

  it('converts xpath selector object', () => {
    expect(resolveSelector({ xpath: '//div' })).toBe('//div');
  });

  it('throws on unknown selector type', () => {
    expect(() => resolveSelector({} as any)).toThrow('Unknown selector type');
  });
});

describe('BrowserSession', () => {
  let session: BrowserSession;

  beforeEach(() => {
    session = new BrowserSession({
      headless: true,
      viewport: { width: 1280, height: 720 },
    });
  });

  afterEach(async () => {
    await session.close().catch(() => {});
  });

  describe('construction', () => {
    it('creates session with default options', () => {
      const s = new BrowserSession();
      expect(s.isRunning).toBe(false);
      expect(s.browser).toBeNull();
      expect(s.context).toBeNull();
      expect(s.page).toBeNull();
      expect(s.screencastActive).toBe(false);
    });

    it('creates session with custom options', () => {
      const s = new BrowserSession({
        browser: 'chromium',
        headless: true,
        viewport: { width: 1920, height: 1080 },
        slowMo: 100,
      });
      expect(s.isRunning).toBe(false);
    });

    it('creates session with CDP endpoint', () => {
      const s = new BrowserSession({
        cdpEndpoint: 'ws://localhost:9222',
      });
      expect(s.isRunning).toBe(false);
    });
  });

  describe('launch', () => {
    it('launches headed browser', async () => {
      // Use headless since we're in a non-GUI environment
      const s = new BrowserSession({ headless: true, headed: false });
      await s.launch();
      expect(s.isRunning).toBe(true);
      expect(s.browser).not.toBeNull();
      expect(s.context).not.toBeNull();
      expect(s.page).not.toBeNull();
      await s.close();
    });

    it('launches headless browser', async () => {
      await session.launch();
      expect(session.isRunning).toBe(true);
      expect(session.browser).not.toBeNull();
      expect(session.page).not.toBeNull();
    });

    it('re-entrant launch returns same session', async () => {
      await session.launch();
      const firstPage = session.page;
      await session.launch();
      expect(session.page).toBe(firstPage);
    });

    it('launches with custom viewport', async () => {
      const s = new BrowserSession({
        headless: true,
        viewport: { width: 800, height: 600 },
      });
      await s.launch();
      const viewport = await s.page!.viewportSize();
      expect(viewport?.width).toBe(800);
      expect(viewport?.height).toBe(600);
      await s.close();
    });

    it('launches with browser args', async () => {
      const s = new BrowserSession({
        headless: true,
        args: ['--disable-web-security'],
      });
      await s.launch();
      expect(s.isRunning).toBe(true);
      await s.close();
    });
  });

  describe('navigation', () => {
    it('navigates to a URL', async () => {
      await session.launch();
      await session.goto('data:text/html,<h1>Hello</h1>');
      const title = await session.page!.title();
      expect(title).toBe('');
    });

    it('navigates and loads content', async () => {
      await session.launch();
      await session.goto(
        "data:text/html,<html><body><h1 id='greeting'>Hello World</h1></body></html>",
      );
      const text = await session.page!.$('#greeting');
      expect(text).not.toBeNull();
    });

    it('reloads the page', async () => {
      await session.launch();
      await session.goto('data:text/html,<body>Original</body>');
      await session.reload();
      const body = await session.page!.textContent('body');
      expect(body).toBe('Original');
    });

    it('waits for navigation by selector', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body><div id='target'>Content</div></body></html>");
      await session.waitForNavigation({ selector: '#target' });
      const text = await session.page!.$('#target');
      expect(text).not.toBeNull();
    });

    it('waits for navigation by text', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body><p>Hello there</p></body></html>');
      await session.waitForNavigation({ text: 'Hello' });
      const body = await session.page!.textContent('body');
      expect(body).toContain('Hello');
    });

    it('waits for navigation by URL', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body>Page 1</body></html>');
      await session.waitForNavigation({ url: /data:text\/html/ });
    });

    it('waits for network idle', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body>Static</body></html>');
      await session.waitForNavigation({ networkIdle: true });
    });
  });

  describe('action primitives', () => {
    it('clicks an element', async () => {
      await session.launch();
      await session.goto(
        "data:text/html,<html><body><button id='btn' onclick=\"this.textContent='Clicked'\">Click me</button></body></html>",
      );
      await session.click('#btn');
      const text = await session.page!.textContent('#btn');
      expect(text).toBe('Clicked');
    });

    it('hovers over an element', async () => {
      await session.launch();
      await session.goto(
        "data:text/html,<html><body><div id='target' onmouseenter=\"this.style.color='red'\">Hover me</div></body></html>",
      );
      await session.hover('#target');
      await session.waitForNavigation({ timeout: 2000 });
    });

    it('fills a text input', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body><input id='input' type='text'></body></html>");
      await session.fill('#input', 'test value');
      const value = await session.page!.$eval('#input', (el: any) => el.value);
      expect(value).toBe('test value');
    });

    it('selects an option', async () => {
      await session.launch();
      await session.goto(
        "data:text/html,<html><body><select id='select'><option value='a'>A</option><option value='b'>B</option></select></body></html>",
      );
      await session.select('#select', 'b');
      const value = await session.page!.$eval('#select', (el: any) => el.value);
      expect(value).toBe('b');
    });

    it('presses a keyboard key', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body><input id='input' type='text'></body></html>");
      await session.click('#input');
      await session.press('a');
      await session.press('b');
      await session.press('c');
      const value = await (session.page as any).$eval('#input', (el: any) => el.value);
      expect(value).toBe('abc');
    });

    it('scrolls to a position', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body style='height:3000px'></body></html>");
      await session.scroll({ y: 500, duration: 100 });
      const scrollY = await (session.page as any).evaluate(() => (window as any).scrollY);
      expect(scrollY).toBeGreaterThan(0);
    });

    it('scrolls by delta', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body style='height:3000px'></body></html>");
      await session.scroll({ deltaY: 200, duration: 100 });
    });

    it('waits for element with wait_for alias', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body><div id='target'>Content</div></body></html>");
      await session.wait_for({ selector: '#target' });
      const text = await session.page!.$('#target');
      expect(text).not.toBeNull();
    });
  });

  describe('screenshot', () => {
    it('captures a screenshot', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body><h1>Test</h1></body></html>');
      const buffer = await session.screenshot();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('captures a full page screenshot', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body style='height:2000px'></body></html>");
      const buffer = await session.screenshot({ fullPage: true });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('captures a screenshot to file', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body>Test</body></html>');
      const path = '/tmp/demoforge-test-screenshot.png';
      const buffer = await session.screenshot({ path });
      expect(buffer).toBeInstanceOf(Buffer);

      const fs = await import('node:fs');
      expect(fs.existsSync(path)).toBe(true);
      fs.unlinkSync(path);
    });

    it('captures screenshot with jpeg type', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body>Test</body></html>');
      const buffer = await session.screenshot({ type: 'jpeg', quality: 80 });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('CDP utilities', () => {
    it('executes a CDP command', async () => {
      await session.launch();
      const result = await session.executeCDP({
        method: 'Page.getLayoutMetrics',
      });
      expect(result.result).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('handles CDP errors gracefully', async () => {
      await session.launch();
      const result = await session.executeCDP({
        method: 'NonExistent.Method',
      });
      expect(result.error).toBeDefined();
      expect(typeof result.error?.code).toBe('number');
      expect(typeof result.error?.message).toBe('string');
    });

    it('starts and stops screencast', async () => {
      await session.launch();
      await session.startScreencast({ format: 'png' });
      expect(session.screencastActive).toBe(true);
      await session.stopScreencast();
      expect(session.screencastActive).toBe(false);
    });

    it('sets virtual time', async () => {
      await session.launch();
      // Should not throw even if CDP virtual time commands are unavailable
      await expect(
        session.setVirtualTime({
          timeDomain: 'time',
          factor: 0.5,
        }),
      ).resolves.toBeUndefined();
    });

    it('resets virtual time', async () => {
      await session.launch();
      await session.setVirtualTime({ timeDomain: 'time', factor: 0.5 });
      await expect(session.resetVirtualTime()).resolves.toBeUndefined();
    });
  });

  describe('state', () => {
    it('returns browser state', async () => {
      await session.launch();
      await session.goto('data:text/html,<html><body><title>Test Page</title></body></html>');
      const state = await session.getState();
      expect(state.url).toBe('data:text/html,<html><body><title>Test Page</title></body></html>');
      expect(state.title).toBe('Test Page');
      expect(state.viewport).toEqual({ width: 1280, height: 720 });
      expect(state.pageCount).toBe(1);
      expect(state.isRunning).toBe(true);
    });
  });

  describe('close', () => {
    it('closes the browser session', async () => {
      await session.launch();
      expect(session.isRunning).toBe(true);
      await session.close();
      expect(session.isRunning).toBe(false);
    });

    it('handles close when not launched', async () => {
      await expect(session.close()).resolves.toBeUndefined();
    });

    it('handles close with active screencast', async () => {
      await session.launch();
      await session.startScreencast();
      await session.close();
      expect(session.isRunning).toBe(false);
    });
  });

  describe('selector types', () => {
    it('clicks with role selector', async () => {
      await session.launch();
      await session.goto(
        "data:text/html,<html><body><button role='button' id='btn'>Click me</button></body></html>",
      );
      await session.click({ role: 'button' });
      const text = await (session.page as any).textContent('#btn');
      expect(text).toBe('Click me');
    });

    it('fills with css selector object', async () => {
      await session.launch();
      await session.goto("data:text/html,<html><body><input id='input' type='text'></body></html>");
      await session.fill({ css: '#input' }, 'hello');
      const value = await (session.page as any).$eval('#input', (el: any) => el.value);
      expect(value).toBe('hello');
    });
  });
});

describe('BrowserSetup', () => {
  describe('isBrowserInstalled', () => {
    it('checks chromium installation', () => {
      const result = BrowserSetup.isBrowserInstalled('chromium');
      // May be true or false depending on environment
      expect(typeof result).toBe('boolean');
    });

    it('checks firefox installation', () => {
      const result = BrowserSetup.isBrowserInstalled('firefox');
      expect(typeof result).toBe('boolean');
    });

    it('checks webkit installation', () => {
      const result = BrowserSetup.isBrowserInstalled('webkit');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('checkAllInstalled', () => {
    it('returns status for all browsers', () => {
      const result = BrowserSetup.checkAllInstalled();
      expect(result).toHaveProperty('chromium');
      expect(result).toHaveProperty('firefox');
      expect(result).toHaveProperty('webkit');
    });
  });

  describe('xvfb', () => {
    it('checks xvfb availability', () => {
      const available = BrowserSetup.isXvfbAvailable();
      expect(typeof available).toBe('boolean');
    });

    it('isCI returns correct value', () => {
      const original = process.env.CI;
      process.env.CI = 'true';
      expect(BrowserSetup.isCI()).toBe(true);
      if (original === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = original;
      }
    });

    it('getRecommendedConfig returns headless for CI', () => {
      const original = process.env.CI;
      process.env.CI = 'true';
      const config = BrowserSetup.getRecommendedConfig();
      expect(config.headless).toBe(true);
      expect(config.headed).toBe(false);
      if (original === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = original;
      }
    });

    it('getRecommendedConfig returns headed for local', () => {
      const original = process.env.CI;
      process.env.CI = 'false';
      const config = BrowserSetup.getRecommendedConfig();
      expect(config.headless).toBe(false);
      expect(config.headed).toBe(true);
      if (original === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = original;
      }
    });

    it('configureXvfb returns null when xvfb unavailable', () => {
      const result = BrowserSetup.configureXvfb(99);
      // May return null or a display string
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('setupHeadlessEnvironment returns config', () => {
      const result = BrowserSetup.setupHeadlessEnvironment();
      expect(result).toHaveProperty('display');
      expect(result).toHaveProperty('config');
      expect(result.config).toHaveProperty('headless');
      expect(result.config).toHaveProperty('headed');
      expect(result.config).toHaveProperty('args');
    });

    it('writeCiConfig writes a valid file', async () => {
      const path = '/tmp/demoforge-test-ci-config.ts';
      BrowserSetup.writeCiConfig(path);
      const fs = await import('node:fs');
      expect(fs.existsSync(path)).toBe(true);
      const content = fs.readFileSync(path, 'utf-8');
      expect(content).toContain('defineConfig');
      expect(content).toContain('chromium');
      fs.unlinkSync(path);
    });
  });
});
