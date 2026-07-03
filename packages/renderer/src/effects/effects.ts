/**
 * DemoForge renderer — EffectsManager.
 *
 * Manages visual effects layered on top of the renderer:
 * - Zoom/pan (Ken Burns effect) via CSS transform on overlay
 * - Element spotlight/dim via CSS overlay with :not() selector
 * - Callout labels via positioned DOM elements injected via CDP
 * - Smooth scroll easing via CSS scroll-behavior
 *
 * All effects are CSS-based: no DOM mutation of app content.
 * Effects use z-index below the synthetic cursor (2147483646).
 * Effect timing is aligned with step timestamps via atTime parameter.
 */

import type { BrowserSession } from '@demoforge/browser';

import type {
  EffectConfig,
  EffectStep,
  EffectStyle,
  SmoothScrollOptions,
  ZoomEffect,
  DimEffect,
  CalloutEffect,
} from './types.js';

// ─── Default Values ──────────────────────────────────────────────────────────

const DEFAULT_STYLE: Required<EffectStyle> = {
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

const EFFECTS_OVERLAY_Z_INDEX = 1000000;
const EFFECTS_DIM_Z_INDEX = 1000001;
const EFFECTS_CALLOUT_Z_INDEX = 1000002;
const CURSOR_Z_INDEX = 2147483646;

// ─── EffectsManager Class ────────────────────────────────────────────────────

export class EffectsManager {
  private _browser: BrowserSession;
  private _config: Required<EffectConfig>;
  private _enabled = true;

  constructor(browser: BrowserSession, config?: EffectConfig) {
    const style: Partial<EffectStyle> = config?.style ?? {};
    this._config = {
      enabled: config?.enabled ?? true,
      style: {
        highlightColor: style.highlightColor ?? DEFAULT_STYLE.highlightColor,
        highlightRing: style.highlightRing ?? DEFAULT_STYLE.highlightRing,
        dimAmount: this._validateDimAmount(style.dimAmount ?? DEFAULT_STYLE.dimAmount),
        calloutBg: style.calloutBg ?? DEFAULT_STYLE.calloutBg,
        calloutText: style.calloutText ?? DEFAULT_STYLE.calloutText,
        calloutFontFamily: style.calloutFontFamily ?? DEFAULT_STYLE.calloutFontFamily,
        calloutFontSize: style.calloutFontSize ?? DEFAULT_STYLE.calloutFontSize,
        zoomDuration: style.zoomDuration ?? DEFAULT_STYLE.zoomDuration,
        zoomScale: this._validateZoomScale(style.zoomScale ?? DEFAULT_STYLE.zoomScale),
        dimDuration: style.dimDuration ?? DEFAULT_STYLE.dimDuration,
        calloutDuration: style.calloutDuration ?? DEFAULT_STYLE.calloutDuration,
        scrollEasing: style.scrollEasing ?? DEFAULT_STYLE.scrollEasing,
        scrollDuration: style.scrollDuration ?? DEFAULT_STYLE.scrollDuration,
      },
    };
    this._browser = browser;
    this._enabled = this._config.enabled;

    if (this._enabled) {
      this._injectBaseStyles();
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get config(): Required<EffectConfig> {
    return { ...this._config };
  }

  // ─── Base Style Injection ──────────────────────────────────────────────

  private _injectBaseStyles(): void {
    const { style } = this._config;

    const css = `
      /* DemoForge Effects — CSS-only, no app DOM mutation */
      /* z-index: ${EFFECTS_OVERLAY_Z_INDEX} (below cursor at ${CURSOR_Z_INDEX}) */

      .demoforge-effects-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: ${EFFECTS_OVERLAY_Z_INDEX};
        transform-origin: center center;
        transition: transform ${style.zoomDuration}ms ${style.scrollEasing};
      }

      .demoforge-effects-dim {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: ${EFFECTS_DIM_Z_INDEX};
        opacity: 0;
        transition: opacity ${style.dimDuration}ms ${style.scrollEasing};
        background: radial-gradient(
          ellipse at center,
          transparent 0%,
          transparent 15%,
          rgba(0, 0, 0, ${style.dimAmount}) 100%
        );
      }

      .demoforge-effects-dim.active {
        opacity: 1;
      }

      .demoforge-effects-callout {
        position: fixed;
        pointer-events: none;
        z-index: ${EFFECTS_CALLOUT_Z_INDEX};
        background: ${style.calloutBg};
        color: ${style.calloutText};
        font-family: ${style.calloutFontFamily};
        font-size: ${style.calloutFontSize};
        padding: 6px 12px;
        border-radius: 6px;
        white-space: nowrap;
        opacity: 0;
        transition: opacity ${style.calloutDuration}ms ${style.scrollEasing},
                    transform ${style.calloutDuration}ms ${style.scrollEasing};
        transform: translateY(0);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        line-height: 1.4;
      }

      .demoforge-effects-callout.active {
        opacity: 1;
        transform: translateY(0);
      }

      .demoforge-effects-callout::before {
        content: '';
        position: absolute;
        width: 8px;
        height: 8px;
        background: ${style.calloutBg};
        transform: rotate(45deg);
      }

      /* Callout position variants */
      .demoforge-effects-callout.position-top {
        bottom: calc(100% + 12px);
        left: 50%;
        transform: translateX(-50%) translateY(8px);
      }
      .demoforge-effects-callout.position-top.active {
        transform: translateX(-50%) translateY(0);
      }
      .demoforge-effects-callout.position-top::before {
        bottom: -4px;
        left: 50%;
        margin-left: -4px;
      }

      .demoforge-effects-callout.position-bottom {
        top: calc(100% + 12px);
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
      }
      .demoforge-effects-callout.position-bottom.active {
        transform: translateX(-50%) translateY(0);
      }
      .demoforge-effects-callout.position-bottom::before {
        top: -4px;
        left: 50%;
        margin-left: -4px;
      }

      .demoforge-effects-callout.position-left {
        right: calc(100% + 12px);
        top: 50%;
        transform: translateX(8px) translateY(-50%);
      }
      .demoforge-effects-callout.position-left.active {
        transform: translateX(0) translateY(-50%);
      }
      .demoforge-effects-callout.position-left::before {
        right: -4px;
        top: 50%;
        margin-top: -4px;
      }

      .demoforge-effects-callout.position-right {
        left: calc(100% + 12px);
        top: 50%;
        transform: translateX(-8px) translateY(-50%);
      }
      .demoforge-effects-callout.position-right.active {
        transform: translateX(0) translateY(-50%);
      }
      .demoforge-effects-callout.position-right::before {
        left: -4px;
        top: 50%;
        margin-top: -4px;
      }

      .demoforge-effects-callout.position-top-left {
        bottom: calc(100% + 12px);
        right: 0;
        transform: translateX(0) translateY(8px);
      }
      .demoforge-effects-callout.position-top-left.active {
        transform: translateX(0) translateY(0);
      }
      .demoforge-effects-callout.position-top-left::before {
        bottom: -4px;
        right: 12px;
      }

      .demoforge-effects-callout.position-top-right {
        bottom: calc(100% + 12px);
        left: 0;
        transform: translateX(0) translateY(8px);
      }
      .demoforge-effects-callout.position-top-right.active {
        transform: translateX(0) translateY(0);
      }
      .demoforge-effects-callout.position-top-right::before {
        bottom: -4px;
        left: 12px;
      }

      .demoforge-effects-callout.position-bottom-left {
        top: calc(100% + 12px);
        right: 0;
        transform: translateX(0) translateY(-8px);
      }
      .demoforge-effects-callout.position-bottom-left.active {
        transform: translateX(0) translateY(0);
      }
      .demoforge-effects-callout.position-bottom-left::before {
        top: -4px;
        right: 12px;
      }

      .demoforge-effects-callout.position-bottom-right {
        top: calc(100% + 12px);
        left: 0;
        transform: translateX(0) translateY(-8px);
      }
      .demoforge-effects-callout.position-bottom-right.active {
        transform: translateX(0) translateY(0);
      }
      .demoforge-effects-callout.position-bottom-right::before {
        top: -4px;
        left: 12px;
      }

      /* Smooth scroll behavior */
      .demoforge-smooth-scroll {
        scroll-behavior: smooth;
      }
    `;

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var style = document.createElement('style');
            style.id = 'demoforge-effects-styles';
            style.textContent = ${JSON.stringify(css)};
            document.documentElement.appendChild(style);

            var overlay = document.createElement('div');
            overlay.id = 'demoforge-effects-overlay';
            overlay.className = 'demoforge-effects-overlay';
            document.documentElement.appendChild(overlay);

            var dim = document.createElement('div');
            dim.id = 'demoforge-effects-dim';
            dim.className = 'demoforge-effects-dim';
            document.documentElement.appendChild(dim);
          })();
        `,
      },
    }).catch(() => {});
  }

  // ─── Effect Application ────────────────────────────────────────────────

  async applyEffect(effect: EffectStep): Promise<void> {
    if (!this._enabled) {
      return;
    }

    switch (effect.type) {
      case 'zoom':
        return this._applyZoom(effect);
      case 'dim':
        return this._applyDim(effect);
      case 'callout':
        return this._applyCallout(effect);
    }
  }

  private _applyZoom(effect: ZoomEffect): void {
    const scale = effect.scale ?? this._config.style.zoomScale;
    const x = effect.x ?? 0.5;
    const y = effect.y ?? 0.5;
    const duration = effect.duration ?? this._config.style.zoomDuration;

    const panX = (x - 0.5) * (scale - 1) * 100;
    const panY = (y - 0.5) * (scale - 1) * 100;

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var overlay = document.getElementById('demoforge-effects-overlay');
            if (overlay) {
              overlay.style.transform = 'scale(${scale}) translate(${panX}%, ${panY}%)';
              overlay.style.transitionDuration = '${duration}ms';
            }
          })();
        `,
      },
    });
  }

  private _applyDim(effect: DimEffect): void {
    const dimAmount = effect.dimAmount ?? this._config.style.dimAmount;
    const duration = effect.duration ?? this._config.style.dimDuration;
    const { highlightColor, highlightRing } = this._config.style;

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var dim = document.getElementById('demoforge-effects-dim');
            if (dim) {
              dim.style.background = 'radial-gradient(ellipse at center, transparent 0%, transparent 15%, rgba(0, 0, 0, ${dimAmount}) 100%)';
              dim.style.transitionDuration = '${duration}ms';
              dim.className = 'demoforge-effects-dim active';

              /* Add highlight ring around target selector using CSS injection */
              var targetStyle = document.getElementById('demoforge-effects-target-style');
              if (targetStyle) targetStyle.remove();
              var ts = document.createElement('style');
              ts.id = 'demoforge-effects-target-style';
              ts.textContent = '${effect.selector} { box-shadow: ${highlightRing}, 0 0 0 4px ${highlightColor} !important; transition: box-shadow ${duration}ms cubic-bezier(0.4, 0, 0.2, 1) !important; }';
              document.documentElement.appendChild(ts);
            }
          })();
        `,
      },
    });
  }

  private _applyCallout(effect: CalloutEffect): void {
    const position = effect.position ?? 'bottom';
    const duration = effect.duration ?? this._config.style.calloutDuration;
    const { calloutBg, calloutText, calloutFontFamily, calloutFontSize } = this._config.style;

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            /* Remove existing callouts */
            var existing = document.getElementById('demoforge-effects-callout');
            if (existing) existing.remove();

            /* Create callout element */
            var callout = document.createElement('div');
            callout.id = 'demoforge-effects-callout';
            callout.className = 'demoforge-effects-callout position-${position}';
            callout.textContent = ${JSON.stringify(effect.text)};
            callout.style.background = ${JSON.stringify(calloutBg)};
            callout.style.color = ${JSON.stringify(calloutText)};
            callout.style.fontFamily = ${JSON.stringify(calloutFontFamily)};
            callout.style.fontSize = ${JSON.stringify(calloutFontSize)};
            callout.style.transitionDuration = '${duration}ms';

            /* Position callout near target element */
            var target = document.querySelector(${JSON.stringify(effect.selector)});
            if (target) {
              var rect = target.getBoundingClientRect();
              callout.style.left = rect.left + 'px';
              callout.style.top = rect.top + 'px';
              callout.style.width = rect.width + 'px';
            }

            document.documentElement.appendChild(callout);

            /* Trigger animation */
            requestAnimationFrame(function() {
              requestAnimationFrame(function() {
                callout.classList.add('active');
              });
            });
          })();
        `,
      },
    });
  }

  // ─── Zoom Reset ────────────────────────────────────────────────────────

  async resetZoom(): Promise<void> {
    if (!this._enabled) {
      return;
    }

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var overlay = document.getElementById('demoforge-effects-overlay');
            if (overlay) {
              overlay.style.transform = 'none';
            }
          })();
        `,
      },
    });
  }

  // ─── Dim Removal ───────────────────────────────────────────────────────

  async removeDim(): Promise<void> {
    if (!this._enabled) {
      return;
    }

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var dim = document.getElementById('demoforge-effects-dim');
            if (dim) {
              dim.className = 'demoforge-effects-dim';
            }
            var targetStyle = document.getElementById('demoforge-effects-target-style');
            if (targetStyle) targetStyle.remove();
          })();
        `,
      },
    });
  }

  // ─── Callout Removal ───────────────────────────────────────────────────

  async removeCallouts(): Promise<void> {
    if (!this._enabled) {
      return;
    }

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var callout = document.getElementById('demoforge-effects-callout');
            if (callout) callout.remove();
          })();
        `,
      },
    });
  }

  // ─── Smooth Scroll ─────────────────────────────────────────────────────

  async scrollSmooth(options: SmoothScrollOptions): Promise<void> {
    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const duration = options.duration ?? this._config.style.scrollDuration;
    const easing = this._config.style.scrollEasing;

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var startX = window.scrollX;
            var startY = window.scrollY;
            var deltaX = ${x} - startX;
            var deltaY = ${y} - startY;
            var startTime = performance.now();
            var duration = ${duration};

            function ease(t) {
              var parts = '${easing}'.match(/([\\d.]+)/g);
              if (!parts || parts.length < 4) {
                return t;
              }
              var p1 = parseFloat(parts[0]);
              var p2 = parseFloat(parts[1]);
              var p3 = parseFloat(parts[2]);
              var p4 = parseFloat(parts[3]);
              return cubicBezierAt(t, p1, p2, p3, p4);
            }

            function cubicBezierAt(t, p1x, p1y, p2x, p2y) {
              if (t <= 0) return 0;
              if (t >= 1) return 1;
              var cx = 3 * p1x;
              var bx = 3 * (p2x - p1x) - cx;
              var ax = 1 - cx - bx;
              var cy = 3 * p1y;
              var by = 3 * (p2y - p1y) - cy;
              var ay = 1 - cy - by;
              var sampleStep = 1 / 64;
              for (var st = 0; st <= 1; st += sampleStep) {
                var x = ((cx + (bx + ax * st) * st) * st);
                if (x >= t) {
                  return ((cy + (by + ay * st) * st) * st);
                }
              }
              return 1;
            }

            function scroll() {
              var elapsed = performance.now() - startTime;
              var progress = Math.min(elapsed / duration, 1);
              var eased = ease(progress);
              window.scrollTo(startX + deltaX * eased, startY + deltaY * eased);
              if (progress < 1) {
                requestAnimationFrame(scroll);
              }
            }

            requestAnimationFrame(scroll);
          })();
        `,
      },
    });
  }

  // ─── Style Updates ─────────────────────────────────────────────────────

  async updateStyle(updates: Partial<EffectStyle>): Promise<void> {
    if (updates.zoomScale !== undefined) {
      this._config.style.zoomScale = this._validateZoomScale(updates.zoomScale);
    }
    if (updates.dimAmount !== undefined) {
      this._config.style.dimAmount = this._validateDimAmount(updates.dimAmount);
    }

    const style = this._config.style;
    Object.assign(style, {
      highlightColor: updates.highlightColor ?? style.highlightColor,
      highlightRing: updates.highlightRing ?? style.highlightRing,
      calloutBg: updates.calloutBg ?? style.calloutBg,
      calloutText: updates.calloutText ?? style.calloutText,
      calloutFontFamily: updates.calloutFontFamily ?? style.calloutFontFamily,
      calloutFontSize: updates.calloutFontSize ?? style.calloutFontSize,
      zoomDuration: updates.zoomDuration ?? style.zoomDuration,
      dimDuration: updates.dimDuration ?? style.dimDuration,
      calloutDuration: updates.calloutDuration ?? style.calloutDuration,
      scrollEasing: updates.scrollEasing ?? style.scrollEasing,
      scrollDuration: updates.scrollDuration ?? style.scrollDuration,
    });
  }

  // ─── Enable/Disable ────────────────────────────────────────────────────

  async setEnabled(enabled: boolean): Promise<void> {
    this._enabled = enabled;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────

  async clearAll(): Promise<void> {
    if (!this._enabled) {
      return;
    }

    this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var overlay = document.getElementById('demoforge-effects-overlay');
            if (overlay) overlay.style.transform = 'none';
            var dim = document.getElementById('demoforge-effects-dim');
            if (dim) dim.className = 'demoforge-effects-dim';
            var callout = document.getElementById('demoforge-effects-callout');
            if (callout) callout.remove();
            var targetStyle = document.getElementById('demoforge-effects-target-style');
            if (targetStyle) targetStyle.remove();
          })();
        `,
      },
    });
  }

  // ─── Validation ────────────────────────────────────────────────────────

  private _validateZoomScale(scale: number): number {
    if (scale < 1 || scale > 3) {
      throw new Error(`zoomScale must be between 1 and 3, got: ${scale}`);
    }
    return scale;
  }

  private _validateDimAmount(amount: number): number {
    if (amount < 0 || amount > 1) {
      throw new Error(`dimAmount must be between 0 and 1, got: ${amount}`);
    }
    return amount;
  }
}
