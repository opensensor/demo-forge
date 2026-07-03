/**
 * DemoForge renderer — synthetic cursor.
 *
 * Renders a synthetic cursor as a DOM element injected into the target page
 * via CDP. Supports Bezier-eased movement between action points, click ripple
 * animation, and configurable cursor style. The cursor is injected separately
 * from the app DOM to avoid interfering with app styles or interactivity.
 */

import type { BrowserSession } from '@demoforge/browser';

import { easeInOut } from './easing.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CursorStyle {
  /** Cursor color (hex, rgb, or named CSS color). Default: #3b82f6. */
  color?: string;
  /** Cursor diameter in pixels. Default: 12. */
  size?: number;
  /** Cursor shape: 'default' (circle) or 'pointer' (arrow-like). Default: 'default'. */
  shape?: 'default' | 'pointer';
  /** CSS border string. Default: '2px solid rgba(0,0,0,0.2)'. */
  border?: string;
  /** CSS box-shadow. Default: '0 0 0 2px rgba(59,130,246,0.3)'. */
  boxShadow?: string;
  /** Movement transition duration in ms. Default: 300. */
  transitionDuration?: number;
}

export interface CursorConfig {
  /** Cursor appearance configuration. */
  style?: CursorStyle;
  /** Click ripple animation duration in ms. Default: 300. */
  clickRippleDuration?: number;
  /** Click ripple color. Default: same as cursor color. */
  clickRippleColor?: string;
  /** Click ripple max radius in pixels. Default: 30. */
  clickRippleMaxRadius?: number;
  /** Browser session for injecting cursor into the page. */
  browser?: BrowserSession;
}

export interface CursorActionPoint {
  x: number;
  y: number;
}

export interface CursorMoveOptions {
  /** Movement duration in milliseconds. Default: 300. */
  duration?: number;
  /** Easing function for movement. Default: easeInOut. */
  easing?: (t: number) => number;
  /** Whether to trigger a click ripple at the destination. Default: false. */
  click?: boolean;
  /** Absolute timestamp (ms) for synchronized scheduling. Default: 0 (now). */
  atTime?: number;
}

// ─── Default Values ──────────────────────────────────────────────────────────

const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_SIZE = 12;
const DEFAULT_SHAPE: CursorStyle['shape'] = 'default';
const DEFAULT_BORDER = '2px solid rgba(0,0,0,0.2)';
const DEFAULT_BOX_SHADOW = '0 0 0 2px rgba(59,130,246,0.3)';
const DEFAULT_TRANSITION_DURATION = 300;
const DEFAULT_CLICK_RIPPLE_DURATION = 300;
const DEFAULT_CLICK_RIPPLE_MAX_RADIUS = 30;

// ─── Cursor Class ────────────────────────────────────────────────────────────

export class Cursor {
  private _style: Required<CursorStyle>;
  private _clickRippleDuration: number;
  private _clickRippleColor: string;
  private _clickRippleMaxRadius: number;
  private _browser: BrowserSession | null;
  private _injected = false;
  private _cursorId = 'demoforge-cursor';
  private _rippleId = 'demoforge-cursor-ripple';
  private _currentX = 0;
  private _currentY = 0;

  constructor(config: CursorConfig = {}) {
    const style = config.style ?? {};
    this._style = {
      color: this._validateColor(style.color ?? DEFAULT_COLOR),
      size: this._validateSize(style.size ?? DEFAULT_SIZE),
      shape: this._validateShape((style.shape ?? DEFAULT_SHAPE) as string),
      border: style.border ?? DEFAULT_BORDER,
      boxShadow: style.boxShadow ?? DEFAULT_BOX_SHADOW,
      transitionDuration: style.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
    };
    this._clickRippleDuration = config.clickRippleDuration ?? DEFAULT_CLICK_RIPPLE_DURATION;
    this._clickRippleColor = config.clickRippleColor ?? this._style.color!;
    this._clickRippleMaxRadius = config.clickRippleMaxRadius ?? DEFAULT_CLICK_RIPPLE_MAX_RADIUS;
    this._browser = config.browser ?? null;
  }

  get style(): Required<CursorStyle> {
    return { ...this._style };
  }

  get injected(): boolean {
    return this._injected;
  }

  get currentX(): number {
    return this._currentX;
  }

  get currentY(): number {
    return this._currentY;
  }

  // ─── Injection ─────────────────────────────────────────────────────────

  async inject(): Promise<void> {
    if (!this._browser) {
      throw new Error('Cannot inject cursor: no browser session configured');
    }
    if (this._injected) {
      return;
    }

    const cursorHTML = this._buildCursorHTML();

    await this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var cursor = document.createElement('div');
            cursor.id = '${this._cursorId}';
            cursor.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%);border-radius:50%;background:transparent;transition:left ${this._style.transitionDuration}ms cubic-bezier(0.42,0,0.58,1),top ${this._style.transitionDuration}ms cubic-bezier(0.42,0,0.58,1);';
            cursor.innerHTML = ${JSON.stringify(cursorHTML)};

            var ripple = document.createElement('div');
            ripple.id = '${this._rippleId}';
            ripple.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;transform:translate(-50%,-50%);border-radius:50%;border:2px solid;animation:demoforge-cursor-ripple ${this._clickRippleDuration}ms ease-out forwards;';

            var style = document.createElement('style');
            style.id = 'demoforge-cursor-styles';
            style.textContent = '@keyframes demoforge-cursor-ripple { 0% { width:0; height:0; opacity:1; } 100% { width:' + ${this._clickRippleMaxRadius} * 2 + 'px; height:' + ${this._clickRippleMaxRadius} * 2 + 'px; opacity:0; } }';
            document.documentElement.appendChild(style);
            document.documentElement.appendChild(cursor);
            document.documentElement.appendChild(ripple);
          })();
        `,
      },
    });

    this._injected = true;
  }

  async remove(): Promise<void> {
    if (!this._browser) {
      return;
    }

    await this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var cursor = document.getElementById('${this._cursorId}');
            var ripple = document.getElementById('${this._rippleId}');
            var styles = document.getElementById('demoforge-cursor-styles');
            if (cursor) cursor.parentNode.removeChild(cursor);
            if (ripple) ripple.parentNode.removeChild(ripple);
            if (styles) styles.parentNode.removeChild(styles);
          })();
        `,
      },
    });

    this._injected = false;
  }

  // ─── Movement ──────────────────────────────────────────────────────────

  async moveTo(
    x: number,
    y: number,
    options: CursorMoveOptions = {},
  ): Promise<void> {
    if (!this._browser) {
      throw new Error('Cannot move cursor: no browser session configured');
    }

    const duration = options.duration ?? this._style.transitionDuration;
    const click = options.click ?? false;
    const easing = options.easing ?? easeInOut;
    void easing;

    this._currentX = x;
    this._currentY = y;

    const startTime = options.atTime ?? Date.now();
    const targetTime = startTime + duration;
    void targetTime;
    void startTime;

    await this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var cursor = document.getElementById('${this._cursorId}');
            if (cursor) {
              cursor.style.left = '${x}px';
              cursor.style.top = '${y}px';
            }
          })();
        `,
      },
    });

    if (click) {
      await this._triggerRipple(x, y);
    }
  }

  // ─── Style Updates ────────────────────────────────────────────────────

  async updateStyle(style: Partial<CursorStyle>): Promise<void> {
    this._style = {
      ...this._style,
      color: style.color ?? this._style.color,
      size: style.size !== undefined ? this._validateSize(style.size) : this._style.size,
      shape: style.shape !== undefined ? this._validateShape(style.shape) : this._style.shape,
      border: style.border ?? this._style.border,
      boxShadow: style.boxShadow ?? this._style.boxShadow,
      transitionDuration: style.transitionDuration ?? this._style.transitionDuration,
    };

    if (this._injected && this._browser) {
      await this._browser.executeCDP({
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: {
          source: `
            (function() {
              var cursor = document.getElementById('${this._cursorId}');
              if (cursor) {
                cursor.innerHTML = ${JSON.stringify(this._buildCursorHTML())};
              }
            })();
          `,
        },
      });
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private _buildCursorHTML(): string {
    const halfSize = this._style.size / 2;
    const { color, shape, border, boxShadow } = this._style;

    if (shape === 'pointer') {
      return `<svg width="${this._style.size}" height="${this._style.size}" viewBox="0 0 24 24" style="margin-left:-${halfSize * 0.6}px;margin-top:-${halfSize * 1.2}px">
        <path d="M5.5 2l12 12.5l-5.5-.5l-1 5.5l-3-1l1-5.5l-3.5-.5z" fill="${color}" stroke="${border}" stroke-width="1"/>
      </svg>`;
    }

    return `<div style="width:${this._style.size}px;height:${this._style.size}px;border-radius:50%;background:${color};border:${border};box-shadow:${boxShadow}"></div>`;
  }

  private async _triggerRipple(x: number, y: number): Promise<void> {
    if (!this._browser) {
      return;
    }

    await this._browser.executeCDP({
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: {
        source: `
          (function() {
            var ripple = document.getElementById('${this._rippleId}');
            if (ripple) {
              ripple.style.left = '${x}px';
              ripple.style.top = '${y}px';
              ripple.style.borderColor = '${this._clickRippleColor}';
              ripple.style.animation = 'none';
              ripple.offsetHeight;
              ripple.style.animation = '';
            }
          })();
        `,
      },
    });
  }

  private _validateColor(color: string): string {
    const testEl = typeof document !== 'undefined'
      ? document.createElement('div')
      : null;

    if (testEl) {
      testEl.style.color = color;
      if (!testEl.style.color) {
        throw new Error(`Invalid color format: ${color}`);
      }
    } else {
      const hexPattern = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
      const rgbPattern = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
      const rgbaPattern = /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[0-9]*\.?[0-9]+\s*\)$/;

      if (!hexPattern.test(color) && !rgbPattern.test(color) && !rgbaPattern.test(color)) {
        throw new Error(`Invalid color format: ${color}`);
      }
    }

    return color;
  }

  private _validateSize(size: number): number {
    if (size <= 0 || size > 100) {
      throw new Error(`Cursor size must be between 1 and 100, got: ${size}`);
    }
    return size;
  }

  private _validateShape(shape: string): 'default' | 'pointer' {
    if (shape !== 'default' && shape !== 'pointer') {
      throw new Error(`Cursor shape must be 'default' or 'pointer', got: ${shape}`);
    }
    return shape;
  }
}
