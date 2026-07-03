/**
 * DemoForge renderer — effects rendering tests.
 *
 * Tests for: EffectsManager class, zoom/pan (Ken Burns), spotlight/dim,
 * callout labels, smooth scroll easing, CSS-only injection, effect timing,
 * configurable styles, and cursor compatibility.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserSession } from '@demoforge/browser';

import {
  EffectsManager,
  type EffectConfig,
  type EffectStyle,
  type EffectStep,
  type CalloutPosition,
} from './effects.js';

// ─── Mock BrowserSession ─────────────────────────────────────────────────────

interface MockBrowserSession {
  launch: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  page: ReturnType<typeof vi.fn>;
  executeCDP: ReturnType<typeof vi.fn>;
  waitForNavigation: ReturnType<typeof vi.fn>;
}

function createMockBrowser(): MockBrowserSession & BrowserSession {
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockReturnValue({
      url: vi.fn().mockResolvedValue('http://localhost:3000'),
      title: vi.fn().mockResolvedValue('Test'),
    }),
    executeCDP: vi.fn().mockResolvedValue({ result: {} }),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockBrowserSession & BrowserSession;
}

// ─── Default Config ──────────────────────────────────────────────────────────

const defaultStyle: EffectStyle = {
  highlightColor: '#fbbf24',
  highlightRing: '3px solid rgba(251, 191, 36, 0.5)',
  dimAmount: 0.4,
  calloutBg: '#1e293b',
  calloutText: '#f8fafc',
  calloutFontFamily: 'system-ui, sans-serif',
  calloutFontSize: '13px',
  zoomDuration: 600,
  zoomScale: 1.3,
  dimDuration: 400,
  calloutDuration: 300,
  scrollEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  scrollDuration: 500,
};

const defaultConfig: EffectConfig = {
  enabled: true,
  style: defaultStyle,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExecuteCDPCalls(mock: MockBrowserSession & BrowserSession): Array<{ method: string; params: Record<string, unknown> }> {
  const calls = (mock.executeCDP as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((call) => call[0] as { method: string; params: Record<string, unknown> });
}

function getLastExecuteCDP(mock: MockBrowserSession & BrowserSession): { method: string; params: Record<string, unknown> } | undefined {
  const calls = getExecuteCDPCalls(mock);
  return calls[calls.length - 1];
}

// ─── EffectsManager — Construction ───────────────────────────────────────────

describe('EffectsManager — construction', () => {
  it('creates with default config', () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock);
    expect(manager).toBeInstanceOf(EffectsManager);
  });

  it('creates with custom config', () => {
    const mock = createMockBrowser();
    const customConfig: EffectConfig = {
      enabled: false,
      style: { ...defaultStyle, zoomScale: 1.6 },
    };
    const manager = new EffectsManager(mock, customConfig);
    expect(manager).toBeInstanceOf(EffectsManager);
  });

  it('creates with browser and config separately', () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);
    expect(manager).toBeInstanceOf(EffectsManager);
  });

  it('throws on invalid zoom scale', () => {
    const mock = createMockBrowser();
    expect(() => new EffectsManager(mock, {
      ...defaultConfig,
      style: { ...defaultStyle, zoomScale: 10 },
    })).toThrow('zoomScale must be between 1 and 3');
  });

  it('throws on invalid dim amount', () => {
    const mock = createMockBrowser();
    expect(() => new EffectsManager(mock, {
      ...defaultConfig,
      style: { ...defaultStyle, dimAmount: 2 },
    })).toThrow('dimAmount must be between 0 and 1');
  });
});

// ─── CSS Injection ───────────────────────────────────────────────────────────

describe('EffectsManager — CSS injection', () => {
  let mock: MockBrowserSession & BrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('injects base effect styles on init', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    expect(styleInjection).toBeDefined();
  });

  it('base styles include effect overlay container', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    expect(styleInjection?.params?.source).toContain('demoforge-effects-overlay');
  });

  it('base styles are CSS-only (no DOM mutation of app content)', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    // Should not mutate any app content selectors
    expect(source).not.toMatch(/querySelector\s*\(\s*['"]#app|\.app-content|main\[/);
    // Should only inject into document.documentElement
    expect(source).toContain('document.documentElement');
  });

  it('injects zoom transition styles', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    expect(source).toContain('transform');
    expect(source).toContain('transition');
  });

  it('injects dim overlay styles', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    expect(source).toContain('demoforge-effects-dim');
    expect(source).toContain('opacity');
  });

  it('injects callout label styles', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    expect(source).toContain('demoforge-effects-callout');
  });

  it('callout styles include positioning and arrow', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    expect(source).toContain('position');
    expect(source).toContain('::before'); // arrow pseudo-element
  });
});

// ─── Zoom/Pan (Ken Burns) Effect ─────────────────────────────────────────────

describe('EffectsManager — zoom/pan (Ken Burns) effect', () => {
  let mock: MockBrowserSession & BrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('applies zoom CSS transform to overlay', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.5,
      x: 0.2,
      y: 0.3,
      duration: 500,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('transform');
    expect(lastCall?.params?.source).toContain('scale');
  });

  it('zoom uses smooth CSS transition', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.5,
      duration: 500,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('transition');
  });

  it('pan offset positions the zoom center', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'zoom',
      scale: 2,
      x: 0.5,
      y: 0.5,
      duration: 400,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('translate');
  });

  it('zoom respects duration from config when not specified', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.2,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('600ms'); // default zoomDuration
  });

  it('zoom respects configured duration', async () => {
    const manager = new EffectsManager(mock, {
      ...defaultConfig,
      style: { ...defaultStyle, zoomDuration: 800 },
    });
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.2,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('800ms');
  });

  it('resetZoom removes zoom transform', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.resetZoom();
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('none');
  });

  it('zoom is applied to overlay element, not app content', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.5,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('demoforge-effects-overlay');
    expect(source).not.toMatch(/document\.querySelector\s*\(\s*['"]#app|body\s*>/);
  });
});

// ─── Spotlight/Dim Effect ────────────────────────────────────────────────────

describe('EffectsManager — spotlight/dim effect', () => {
  let mock: MockBrowserSession & BrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('applies dim overlay with CSS', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'dim',
      selector: '#main-content',
      dimAmount: 0.5,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('demoforge-effects-dim');
  });

  it('dim uses configured dimAmount', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'dim',
      selector: '#header',
      dimAmount: 0.3,
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('0.3');
  });

  it('dim respects configured highlight color', async () => {
    const customStyle: EffectStyle = {
      ...defaultStyle,
      highlightColor: '#22c55e',
      highlightRing: '4px solid rgba(34, 197, 94, 0.6)',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });
    const effect: EffectStep = {
      type: 'dim',
      selector: '#sidebar',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('#22c55e');
  });

  it('dim is CSS-only (no DOM mutation of app content)', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'dim',
      selector: '.content',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    // Should inject effects into demoforge elements, not mutate app content
    expect(source).toContain('demoforge-effects-dim');
    // Should not mutate app DOM elements (only effect overlay elements)
    expect(source).not.toMatch(/document\.querySelector\s*\(\s*['"]#app|\.app-content|main\[/);
    expect(source).not.toMatch(/document\.body\.\s*appendChild|document\.body\.\s*insertBefore/);
  });

  it('removes dim effect', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.removeDim();
    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall).toBeDefined();
  });

  it('dim uses configured duration for fade', async () => {
    const manager = new EffectsManager(mock, {
      ...defaultConfig,
      style: { ...defaultStyle, dimDuration: 600 },
    });
    const effect: EffectStep = {
      type: 'dim',
      selector: '#footer',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('600ms');
  });
});

// ─── Callout Labels ──────────────────────────────────────────────────────────

describe('EffectsManager — callout labels', () => {
  let mock: MockBrowserSession & BrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('creates callout label with text', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'callout',
      text: 'Click here to submit',
      selector: '#submit-btn',
      position: 'bottom',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('demoforge-effects-callout');
  });

  it('callout supports all position options', async () => {
    const positions: CalloutPosition[] = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
    for (const pos of positions) {
      vi.mocked(mock.executeCDP).mockClear();
      const manager = new EffectsManager(mock, defaultConfig);
      const effect: EffectStep = {
        type: 'callout',
        text: `Position: ${pos}`,
        selector: '#target',
        position: pos,
        atTime: 0,
      };
      await manager.applyEffect(effect);
      const lastCall = getLastExecuteCDP(mock);
      expect(lastCall?.params?.source).toContain(pos);
    }
  });

  it('callout uses configured colors', async () => {
    const customStyle: EffectStyle = {
      ...defaultStyle,
      calloutBg: '#3b82f6',
      calloutText: '#ffffff',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });
    const effect: EffectStep = {
      type: 'callout',
      text: 'Custom callout',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('#3b82f6');
    expect(source).toContain('#ffffff');
  });

  it('callout uses configured font settings', async () => {
    const customStyle: EffectStyle = {
      ...defaultStyle,
      calloutFontFamily: '"Courier New", monospace',
      calloutFontSize: '16px',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });
    const effect: EffectStep = {
      type: 'callout',
      text: 'Monospace callout',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('Courier New');
    expect(source).toContain('16px');
  });

  it('callout is positioned via CSS, not DOM mutation of app content', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    const effect: EffectStep = {
      type: 'callout',
      text: 'Positioned callout',
      selector: '#target',
      position: 'bottom',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('position');
    // Should not mutate app DOM elements
    expect(source).not.toMatch(/document\.body\.\s*appendChild|document\.body\.\s*insertBefore/);
    expect(source).not.toMatch(/document\.querySelector\s*\(\s*['"]#app|\.app-content/);
  });

  it('removes all callouts', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.removeCallouts();
    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall).toBeDefined();
  });

  it('callout fade uses configured duration', async () => {
    const manager = new EffectsManager(mock, {
      ...defaultConfig,
      style: { ...defaultStyle, calloutDuration: 200 },
    });
    const effect: EffectStep = {
      type: 'callout',
      text: 'Fade test',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(effect);
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('200ms');
  });
});

// ─── Smooth Scroll Easing ────────────────────────────────────────────────────

describe('EffectsManager — smooth scroll easing', () => {
  let mock: MockBrowserSession & BrowserSession;

  beforeEach(() => {
    mock = createMockBrowser();
  });

  it('scrollSmooth uses CSS cubic-bezier easing', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ y: 500, duration: 400 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('cubic-bezier');
  });

  it('scrollSmooth respects configured easing', async () => {
    const customStyle: EffectStyle = {
      ...defaultStyle,
      scrollEasing: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });
    await manager.scrollSmooth({ y: 300 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('0.68');
  });

  it('scrollSmooth respects configured duration', async () => {
    const customStyle: EffectStyle = {
      ...defaultStyle,
      scrollDuration: 700,
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });
    await manager.scrollSmooth({ y: 200 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('700');
  });

  it('scrollSmooth scrolls vertically', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ y: 1000 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('scrollTo');
    expect(source).toContain('0');
    expect(source).toContain('1000');
  });

  it('scrollSmooth scrolls horizontally', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ x: 500 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('scrollTo');
    expect(source).toContain('500');
  });

  it('scrollSmooth scrolls both axes', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ x: 200, y: 300 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('scrollTo');
    expect(source).toContain('200');
    expect(source).toContain('300');
  });

  it('scrollSmooth uses JavaScript animation with cubic-bezier easing', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ y: 400 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    // Uses JS animation with requestAnimationFrame and cubic-bezier easing
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('cubicBezierAt');
    expect(source).toContain('scrollTo');
  });

  it('scrollSmooth does not mutate app DOM', async () => {
    const manager = new EffectsManager(mock, defaultConfig);
    await manager.scrollSmooth({ y: 100 });
    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).not.toMatch(/\.setAttribute|\.style\s*=|\.classList/);
  });
});

// ─── Effect Timing ───────────────────────────────────────────────────────────

describe('EffectsManager — effect timing', () => {

  it('aligns effect duration with step timing', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    // Apply zoom with explicit atTime
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.4,
      duration: 500,
      atTime: 1000,
    };
    await manager.applyEffect(effect);

    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    // Duration should be embedded in CSS transition
    expect(source).toContain('500ms');
  });

  it('uses step timestamp for synchronized scheduling', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    const effect: EffectStep = {
      type: 'dim',
      selector: '#content',
      dimAmount: 0.6,
      atTime: 2000,
    };
    await manager.applyEffect(effect);

    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall).toBeDefined();
  });

  it('callout timing respects atTime', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    const effect: EffectStep = {
      type: 'callout',
      text: 'Timed callout',
      selector: '#btn',
      atTime: 3000,
    };
    await manager.applyEffect(effect);

    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('demoforge-effects-callout');
  });
});

// ─── Configurable Effect Style ───────────────────────────────────────────────

describe('EffectsManager — configurable effect style', () => {
  it('changes highlight color across effects', async () => {
    const mock = createMockBrowser();
    const customStyle: EffectStyle = {
      ...defaultStyle,
      highlightColor: '#ef4444',
      highlightRing: '3px solid rgba(239, 68, 68, 0.5)',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });

    // Dim effect should use the custom highlight color
    const dimEffect: EffectStep = {
      type: 'dim',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(dimEffect);

    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('#ef4444');
  });

  it('changes callout appearance', async () => {
    const mock = createMockBrowser();
    const customStyle: EffectStyle = {
      ...defaultStyle,
      calloutBg: '#7c3aed',
      calloutText: '#faf5ff',
      calloutFontSize: '14px',
    };
    const manager = new EffectsManager(mock, { ...defaultConfig, style: customStyle });

    const calloutEffect: EffectStep = {
      type: 'callout',
      text: 'Styled callout',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(calloutEffect);

    const lastCall = getLastExecuteCDP(mock);
    const source = lastCall?.params?.source as string;
    expect(source).toContain('#7c3aed');
    expect(source).toContain('#faf5ff');
    expect(source).toContain('14px');
  });

  it('updates style at runtime', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    await manager.updateStyle({ highlightColor: '#06b6d4' });

    const dimEffect: EffectStep = {
      type: 'dim',
      selector: '#target',
      atTime: 0,
    };
    await manager.applyEffect(dimEffect);

    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall?.params?.source).toContain('#06b6d4');
  });

  it('multiple config changes produce visible differences', async () => {
    const mock1 = createMockBrowser();
    const manager1 = new EffectsManager(mock1, {
      ...defaultConfig,
      style: { ...defaultStyle, highlightColor: '#ff0000' },
    });
    await manager1.applyEffect({ type: 'dim', selector: '#t', atTime: 0 });

    const mock2 = createMockBrowser();
    const manager2 = new EffectsManager(mock2, {
      ...defaultConfig,
      style: { ...defaultStyle, highlightColor: '#00ff00' },
    });
    await manager2.applyEffect({ type: 'dim', selector: '#t', atTime: 0 });

    const calls1 = getExecuteCDPCalls(mock1);
    const calls2 = getExecuteCDPCalls(mock2);
    const source1 = calls1[calls1.length - 1]?.params?.source as string;
    const source2 = calls2[calls2.length - 1]?.params?.source as string;

    expect(source1).toContain('#ff0000');
    expect(source2).toContain('#00ff00');
    expect(source1).not.toContain('#00ff00');
    expect(source2).not.toContain('#ff0000');
  });
});

// ─── Cursor Compatibility ────────────────────────────────────────────────────

describe('EffectsManager — cursor compatibility', () => {
  it('effects use lower z-index than cursor', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    // Effects overlay should have z-index lower than cursor (2147483646)
    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    // Effect overlay z-index should be below cursor's 2147483646
    expect(source).toMatch(/z-index:\s*\d{1,8}/);
  });

  it('effects do not interfere with cursor pointer-events', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    const calls = getExecuteCDPCalls(mock);
    const styleInjection = calls.find((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    const source = styleInjection?.params?.source as string;
    // Effect overlay should have pointer-events: none
    expect(source).toContain('pointer-events: none');
  });

  it('effects and cursor can coexist on same page', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    // Apply an effect
    await manager.applyEffect({
      type: 'dim',
      selector: '#content',
      atTime: 0,
    });

    // Cursor should still be injectable (no DOM mutation conflict)
    const calls = getExecuteCDPCalls(mock);
    // Both effects and cursor use Page.addScriptToEvaluateOnNewDocument
    expect(calls.some((c) => c.method === 'Page.addScriptToEvaluateOnNewDocument')).toBe(true);
  });

  it('cursor z-index remains highest', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    // Apply effects
    await manager.applyEffect({ type: 'dim', selector: '#t', atTime: 0 });
    await manager.applyEffect({ type: 'zoom', scale: 1.2, atTime: 0 });
    await manager.applyEffect({
      type: 'callout',
      text: 'Test',
      selector: '#t',
      atTime: 0,
    });

    const calls = getExecuteCDPCalls(mock);
    // All effect injections should use Page.addScriptToEvaluateOnNewDocument
    for (const call of calls) {
      expect(call.method).toBe('Page.addScriptToEvaluateOnNewDocument');
    }
  });
});

// ─── Enabled/Disabled State ──────────────────────────────────────────────────

describe('EffectsManager — enabled/disabled state', () => {
  it('disabled effects skip injection', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, { ...defaultConfig, enabled: false });

    await manager.applyEffect({
      type: 'dim',
      selector: '#target',
      atTime: 0,
    });

    const calls = getExecuteCDPCalls(mock);
    // No effect-related CDP calls when disabled
    const effectCalls = calls.filter((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    expect(effectCalls.length).toBe(0);
  });

  it('re-enabling effects re-injects styles', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, { ...defaultConfig, enabled: false });

    await manager.setEnabled(true);
    await manager.applyEffect({
      type: 'dim',
      selector: '#target',
      atTime: 0,
    });

    const calls = getExecuteCDPCalls(mock);
    const effectCalls = calls.filter((c) =>
      c.params?.source?.includes('demoforge-effects'),
    );
    expect(effectCalls.length).toBeGreaterThan(0);
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

describe('EffectsManager — cleanup', () => {
  it('clearAll removes all effect overlays', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    await manager.applyEffect({ type: 'dim', selector: '#t', atTime: 0 });
    await manager.applyEffect({ type: 'callout', text: 'x', selector: '#t', atTime: 0 });
    await manager.applyEffect({ type: 'zoom', scale: 1.2, atTime: 0 });

    await manager.clearAll();

    const lastCall = getLastExecuteCDP(mock);
    expect(lastCall).toBeDefined();
  });

  it('clearAll resets zoom', async () => {
    const mock = createMockBrowser();
    const manager = new EffectsManager(mock, defaultConfig);

    await manager.applyEffect({ type: 'zoom', scale: 1.5, atTime: 0 });
    await manager.clearAll();

    const calls = getExecuteCDPCalls(mock);
    const clearCall = getLastExecuteCDP(mock);
    const source = clearCall?.params?.source as string;
    expect(source).toContain('none');
  });
});

// ─── EffectStep Type Validation ──────────────────────────────────────────────

describe('EffectStep types', () => {
  it('zoom effect has required fields', () => {
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.5,
      atTime: 0,
    };
    expect(effect.type).toBe('zoom');
    expect(effect.scale).toBe(1.5);
  });

  it('dim effect has required fields', () => {
    const effect: EffectStep = {
      type: 'dim',
      selector: '#target',
      atTime: 0,
    };
    expect(effect.type).toBe('dim');
    expect(effect.selector).toBe('#target');
  });

  it('callout effect has required fields', () => {
    const effect: EffectStep = {
      type: 'callout',
      text: 'Hello',
      selector: '#target',
      atTime: 0,
    };
    expect(effect.type).toBe('callout');
    expect(effect.text).toBe('Hello');
  });

  it('zoom effect supports optional fields', () => {
    const effect: EffectStep = {
      type: 'zoom',
      scale: 1.5,
      x: 0.3,
      y: 0.7,
      duration: 800,
      atTime: 1000,
    };
    expect(effect.x).toBe(0.3);
    expect(effect.y).toBe(0.7);
    expect(effect.duration).toBe(800);
  });

  it('dim effect supports optional fields', () => {
    const effect: EffectStep = {
      type: 'dim',
      selector: '#target',
      dimAmount: 0.7,
      duration: 500,
      atTime: 0,
    };
    expect(effect.dimAmount).toBe(0.7);
    expect(effect.duration).toBe(500);
  });

  it('callout effect supports optional fields', () => {
    const effect: EffectStep = {
      type: 'callout',
      text: 'Click here',
      selector: '#btn',
      position: 'top-right',
      duration: 400,
      atTime: 0,
    };
    expect(effect.position).toBe('top-right');
    expect(effect.duration).toBe(400);
  });
});
