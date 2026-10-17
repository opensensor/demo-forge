/**
 * DemoForge renderer — script replay engine.
 *
 * Loads a DemoScript and executes steps via a BrowserSession abstraction.
 * Interactions are choreographed for the camera: the target is scrolled into
 * view, the synthetic cursor glides to it, optional spotlight/callout/zoom
 * effects play, and only then does the real action happen.
 *
 * Also handles: unrecorded `setup` steps (e.g. login) whose cookies carry into
 * the recorded session, narration timing, timeout policies, and screenshots.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DemoScript, DemoStep, Effect, Selector, WaitForCondition } from '@demoforge/core';
import {
  isClickStep,
  isDoneStep,
  isFillStep,
  isGotoStep,
  isHoverStep,
  isMarkFlowEndStep,
  isMarkFlowStartStep,
  isNarrateStep,
  isPauseStep,
  isPressStep,
  isReloadStep,
  isScreenshotStep,
  isScrollStep,
  isSelectStep,
  isSetStorageStep,
  isWaitForStep,
} from '@demoforge/core';

import { BrowserSession, type BoundingBox, type StorageState } from '@demoforge/browser';

import { Stage } from '../stage/stage.js';
import type {
  NarrationEvent,
  RenderConfig,
  RenderResult,
  StepResult,
  StepResultFailure,
  StepResultSuccess,
  StepResultTimeout,
  StepResultTiming,
} from './types.js';

// ─── RenderError ─────────────────────────────────────────────────────────────

export class RenderError extends Error {
  override name = 'RenderError';
  stepIndex?: number;
  stepType?: string;

  constructor(message: string, options?: { stepIndex?: number; stepType?: string }) {
    super(message);
    this.stepIndex = options?.stepIndex;
    this.stepType = options?.stepType;
    Object.setPrototypeOf(this, RenderError.prototype);
  }
}

/** How long effects stay on screen before the action happens. */
const EFFECT_HOLD_MS = 1100;
/** Gap after a narration line before the next step. */
const NARRATION_GAP_MS = 350;

type ResolvedConfig = Required<
  Omit<RenderConfig, 'narration' | 'setupBrowserFactory' | 'onLog'>
> &
  Pick<RenderConfig, 'narration' | 'setupBrowserFactory' | 'onLog'>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Init script that blurs elements matching `selectors`. A stylesheet (not a
 * one-off DOM edit) so elements rendered later — modals, lazy rows — are
 * covered from their first frame.
 */
export function redactionScript(selectors: string[]): string {
  const css = `${selectors.join(',\n')} { filter: blur(7px) !important; }`;
  return `(() => {
    const css = ${JSON.stringify(css)};
    const apply = () => {
      if (document.getElementById('__df-redact')) return;
      const style = document.createElement('style');
      style.id = '__df-redact';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
    if (document.documentElement) apply();
    document.addEventListener('DOMContentLoaded', apply);
  })();`;
}

// ─── Renderer ────────────────────────────────────────────────────────────────

export class Renderer {
  private _browser: BrowserSession;
  private _stage: Stage;
  private _config: ResolvedConfig;
  private _script: DemoScript;
  private _steps: DemoScript['steps'];
  private _results: StepResult[] = [];
  private _startTime = 0;
  private _videoStart = 0;
  private _contentStartMs: number | undefined;
  private _narration: NarrationEvent[] = [];
  /** When the most recent narration line (plus gap) finishes playing. */
  private _narrationBusyUntil = 0;
  private _screenshots: string[] = [];
  private _cspDetected = false;
  private _inSetup = false;

  constructor(script: DemoScript, config?: RenderConfig, browser?: BrowserSession) {
    this._browser = browser ?? new BrowserSession({
      headless: true,
      viewport: script.viewport,
    });
    this._config = {
      globalTimeout: config?.globalTimeout ?? 120000,
      stepTimeout: config?.stepTimeout ?? 30000,
      defaultSettle: config?.defaultSettle ?? 'load',
      outputDir: config?.outputDir ?? '',
      captureOnFailure: config?.captureOnFailure ?? true,
      computeAxDiffOnFailure: config?.computeAxDiffOnFailure ?? true,
      stabilityAttempts: config?.stabilityAttempts ?? 3,
      typingDelay: config?.typingDelay ?? 55,
      narration: config?.narration,
      setupBrowserFactory: config?.setupBrowserFactory,
      onLog: config?.onLog,
    };
    this._script = script;
    this._steps = script.steps;
    this._stage = new Stage(this._browser, { cursor: script.cursor ?? true });
  }

  get cspDetected(): boolean {
    return this._cspDetected;
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  async render(): Promise<RenderResult> {
    this._results = [];
    this._narration = [];
    this._narrationBusyUntil = 0;
    this._screenshots = [];
    this._contentStartMs = undefined;
    this._startTime = Date.now();
    this._cspDetected = false;

    try {
      await this._prepareContext();
    } catch (error) {
      this._results.push({
        status: 'failure',
        stepIndex: -1,
        stepType: 'setup',
        duration: Date.now() - this._startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return this._buildResult('failure');
    }

    await this._browser.launch();
    this._videoStart = Date.now();
    await this._installInit();

    try {
      for (let i = 0; i < this._steps.length; i++) {
        const step = this._steps[i];

        if (step === undefined) {
          continue;
        }

        if (this._isGlobalTimeout()) {
          const result: StepResultTimeout = {
            status: 'timeout',
            stepIndex: i,
            stepType: this._getStepType(step),
            duration: Date.now() - this._startTime,
            timeoutMs: this._config.globalTimeout,
          };
          this._results.push(result);
          return this._buildResult('timeout');
        }

        const result = await this._executeStep(step, i);
        this._results.push(result);

        if (result.status === 'failure') {
          await this._captureFailure(i);
          return this._buildResult('failure');
        }

        if (result.status === 'timeout') {
          await this._captureFailure(i);
          return this._buildResult('timeout');
        }

        if (this._isGlobalTimeout()) {
          const timeoutResult: StepResultTimeout = {
            status: 'timeout',
            stepIndex: i + 1,
            stepType: 'unknown',
            duration: Date.now() - this._startTime,
            timeoutMs: this._config.globalTimeout,
          };
          this._results.push(timeoutResult);
          return this._buildResult('timeout');
        }

        if (result.stepType === 'done') {
          break;
        }
      }
    } finally {
      await this._browser.close().catch(() => {});
    }

    return this._buildResult('success');
  }

  // ─── Setup & Init ───────────────────────────────────────────────────────

  /**
   * Run only the script's `setup` steps in an unrecorded browser and return
   * the resulting cookies/storage — e.g. to hand a logged-in session to the
   * explorer agent. Returns undefined when the script has no setup.
   */
  async runSetup(): Promise<StorageState | undefined> {
    if (!this._script.setup || this._script.setup.length === 0) {
      return undefined;
    }
    return this._runSetup(this._script.setup);
  }

  /** Run `setup` steps in a throwaway browser and apply script-level init. */
  private async _prepareContext(): Promise<void> {
    let storageState: StorageState | undefined;
    if (this._script.setup && this._script.setup.length > 0) {
      storageState = await this._runSetup(this._script.setup);
    }
    this._browser.configureContext({
      storageState,
      colorScheme: this._script.init?.color_scheme,
    });
  }

  private async _runSetup(steps: DemoStep[]): Promise<StorageState> {
    const setupBrowser = this._config.setupBrowserFactory?.() ?? new BrowserSession({
      headless: true,
      headed: false,
      forbidHostDisplay: true,
      viewport: { width: this._script.viewport.width, height: this._script.viewport.height },
    });

    const mainBrowser = this._browser;
    const mainStage = this._stage;
    this._browser = setupBrowser;
    this._stage = new Stage(setupBrowser, { cursor: false });
    this._inSetup = true;
    this._log(`setup: ${steps.length} step(s) in an unrecorded browser`);

    try {
      await setupBrowser.launch();
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        const result = await this._executeStep(step, i);
        if (result.status === 'failure' || result.status === 'timeout') {
          const detail = result.status === 'failure' ? result.error : `timed out after ${result.timeoutMs}ms`;
          throw new RenderError(`setup step ${i} (${result.stepType}) failed: ${detail}`, {
            stepIndex: i,
            stepType: result.stepType,
          });
        }
      }
      return await setupBrowser.storageState();
    } finally {
      await setupBrowser.close().catch(() => {});
      this._browser = mainBrowser;
      this._stage = mainStage;
      this._inSetup = false;
    }
  }

  private async _installInit(): Promise<void> {
    const localStorageEntries = this._script.init?.local_storage;
    if (localStorageEntries && Object.keys(localStorageEntries).length > 0) {
      await this._browser.addInitScript(
        `(() => { try { const e = ${JSON.stringify(localStorageEntries)};` +
          ` for (const k of Object.keys(e)) if (localStorage.getItem(k) === null) localStorage.setItem(k, e[k]);` +
          ` } catch (err) {} })();`,
      );
    }
    const redact = this._script.redact ?? [];
    if (redact.length > 0) {
      await this._browser.addInitScript(redactionScript(redact));
    }
    await this._stage.install();
  }

  // ─── Step Execution ─────────────────────────────────────────────────────

  private async _executeStep(step: DemoScript['steps'][number], index: number): Promise<StepResult> {
    const stepType = this._getStepType(step);
    const stepStart = Date.now();
    if (!this._inSetup) {
      this._log(`step ${index}: ${stepType}`);
    }

    // Narration may legitimately hold longer than a normal step, including
    // waiting for a previous non-blocking line to finish.
    const narrationHold = isNarrateStep(step)
      ? this._narrationDuration(step, index) + Math.max(0, this._narrationBusyUntil - Date.now())
      : 0;
    const timeoutMs = this._config.stepTimeout + narrationHold;

    return new Promise<StepResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          status: 'timeout',
          stepIndex: index,
          stepType,
          duration: Date.now() - stepStart,
          timeoutMs,
        });
      }, timeoutMs);

      this._runStep(step, index)
        .then((result) => {
          clearTimeout(timeout);
          if (result.status === 'success') {
            // Report per-step duration (not cumulative time since render start)
            resolve({ ...result, duration: Date.now() - stepStart });
          } else {
            resolve(result);
          }
        })
        .catch((error) => {
          clearTimeout(timeout);
          const duration = Date.now() - stepStart;
          const failure: StepResultFailure = {
            status: 'failure',
            stepIndex: index,
            stepType,
            duration,
            error: error instanceof Error ? error.message : String(error),
          };
          resolve(failure);
        });
    });
  }

  private async _runStep(
    step: DemoScript['steps'][number],
    index: number,
  ): Promise<StepResultSuccess | StepResultTiming> {
    if (isGotoStep(step)) return this._executeGoto(step, index);
    if (isClickStep(step)) return this._executeClick(step, index);
    if (isHoverStep(step)) return this._executeHover(step, index);
    if (isFillStep(step)) return this._executeFill(step, index);
    if (isSelectStep(step)) return this._executeSelect(step, index);
    if (isPressStep(step)) return this._executePress(step, index);
    if (isScrollStep(step)) return this._executeScroll(step, index);
    if (isWaitForStep(step)) return this._executeWaitFor(step, index);
    if (isNarrateStep(step)) return this._executeNarrate(step, index);
    if (isScreenshotStep(step)) return this._executeScreenshot(step, index);
    if (isMarkFlowStartStep(step)) return this._success('mark_flow_start', index);
    if (isMarkFlowEndStep(step)) return this._success('mark_flow_end', index);
    if (isPauseStep(step)) return this._executePause(step, index);
    if (isSetStorageStep(step)) return this._executeSetStorage(step, index);
    if (isReloadStep(step)) return this._executeReload(index);
    if (isDoneStep(step)) return this._success('done', index);

    throw new RenderError(`Unknown step type: ${JSON.stringify(step)}`, {
      stepIndex: index,
    });
  }

  // ─── Choreography ───────────────────────────────────────────────────────

  /**
   * Bring the target on screen, glide the cursor to it, and play any effect
   * or callout. Returns the target box and whether effects need clearing.
   */
  private async _approach(
    selector: Selector,
    effect?: Effect,
    callout?: string,
  ): Promise<{ box: BoundingBox | null; decorated: boolean }> {
    if (this._inSetup || (!this._stage.cursorEnabled && !effect && !callout)) {
      return { box: null, decorated: false };
    }

    await this._browser.scrollIntoView(selector).catch(() => {});
    const box = await this._browser.boundingBox(selector).catch(() => null);
    if (!box) {
      return { box: null, decorated: false };
    }

    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + Math.min(box.height / 2, 24));
    await this._stage.moveTo(x, y);
    await this._browser.mouseMove(x, y).catch(() => {});

    const decorated = await this._decorate(box, effect, callout);
    return { box, decorated };
  }

  private async _decorate(box: BoundingBox, effect?: Effect, callout?: string): Promise<boolean> {
    if (!effect && !callout) {
      return false;
    }
    if (effect === 'zoom') {
      await this._stage.zoom(box);
    } else if (effect === 'highlight') {
      await this._stage.spotlight(box, false);
    } else if (effect === 'dim' || effect === 'callout') {
      await this._stage.spotlight(box, true);
    }
    if (callout) {
      await this._stage.callout(box, callout);
    }
    await sleep(EFFECT_HOLD_MS);
    return true;
  }

  private async _undecorate(effect?: Effect): Promise<void> {
    if (effect === 'zoom') {
      await this._stage.zoom(null);
    }
    await this._stage.clear();
  }

  // ─── Individual Step Handlers ───────────────────────────────────────────

  private async _executeGoto(
    step: { goto: string; settle?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const settle = step.settle ?? this._config.defaultSettle;
    await this._browser.goto(step.goto, settle as 'load' | 'domcontentloaded' | 'networkidle');
    if (!this._inSetup && this._contentStartMs === undefined) {
      this._contentStartMs = Date.now() - this._videoStart;
    }
    return this._success('goto', index);
  }

  private async _executeClick(
    step: { click: Selector; effect?: Effect; callout?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const { decorated } = await this._approach(step.click, step.effect, step.callout);
    if (decorated) {
      await this._undecorate(step.effect);
    }
    if (!this._inSetup) {
      await this._stage.clickRipple();
    }
    await this._browser.click(step.click);
    return this._success('click', index);
  }

  private async _executeHover(
    step: { hover: Selector; effect?: Effect; callout?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const { decorated } = await this._approach(step.hover, step.effect, step.callout);
    await this._browser.hover(step.hover);
    if (decorated) {
      await this._undecorate(step.effect);
    }
    return this._success('hover', index);
  }

  private async _executeFill(
    step: {
      fill: { target: Selector; value: string; typing?: 'natural' | 'instant' };
      effect?: Effect;
      callout?: string;
    },
    index: number,
  ): Promise<StepResultSuccess> {
    const { decorated } = await this._approach(step.fill.target, step.effect, step.callout);
    const natural = !this._inSetup && (step.fill.typing ?? 'natural') === 'natural';
    if (!this._inSetup) {
      await this._stage.clickRipple();
    }
    if (natural) {
      await this._browser.type(step.fill.target, step.fill.value, this._config.typingDelay);
    } else {
      await this._browser.fill(step.fill.target, step.fill.value);
    }
    if (decorated) {
      await this._undecorate(step.effect);
    }
    return this._success('fill', index);
  }

  private async _executeSelect(
    step: { select: { target: Selector; value: string }; effect?: Effect; callout?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const { decorated } = await this._approach(step.select.target, step.effect, step.callout);
    if (!this._inSetup) {
      await this._stage.clickRipple();
    }
    await this._browser.select(step.select.target, step.select.value);
    if (decorated) {
      await this._undecorate(step.effect);
    }
    return this._success('select', index);
  }

  private async _executePress(
    step: { press: { key: string } },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.press(step.press.key);
    return this._success('press', index);
  }

  private async _executeScroll(
    step: { scroll: { amount?: number; to?: Selector } },
    index: number,
  ): Promise<StepResultSuccess> {
    const { amount, to } = step.scroll;
    if (to !== undefined) {
      const box = await this._browser.boundingBox(to).catch(() => null);
      const viewportHeight = this._script.viewport.height;
      if (box) {
        await this._smoothWheel(box.y + box.height / 2 - viewportHeight / 2);
      }
      await this._browser.scrollIntoView(to);
    } else if (amount !== undefined) {
      await this._smoothWheel(amount);
    }
    return this._success('scroll', index);
  }

  /** Wheel-scroll in small increments so the motion reads on camera. */
  private async _smoothWheel(deltaY: number): Promise<void> {
    if (Math.abs(deltaY) < 4) return;
    const steps = this._inSetup ? 1 : Math.min(24, Math.max(6, Math.round(Math.abs(deltaY) / 40)));
    for (let i = 0; i < steps; i++) {
      await this._browser.scroll({ deltaY: deltaY / steps });
      if (!this._inSetup) await sleep(16);
    }
    if (!this._inSetup) await sleep(250);
  }

  private async _executeWaitFor(
    step: { wait_for: WaitForCondition; effect?: Effect; callout?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const condition = step.wait_for;

    if ('text' in condition) {
      await this._browser.wait_for({
        text: condition.text,
        timeout: condition.timeout ?? 10000,
      });
    } else if ('selector' in condition) {
      await this._browser.wait_for({
        selector: condition.selector as Parameters<typeof this._browser.wait_for>[0]['selector'],
        timeout: condition.timeout ?? 10000,
      });
      if (!this._inSetup && (step.effect || step.callout)) {
        const box = await this._browser.boundingBox(condition.selector as Selector).catch(() => null);
        if (box && (await this._decorate(box, step.effect, step.callout))) {
          await this._undecorate(step.effect);
        }
      }
    }

    return this._success('wait_for', index);
  }

  private _narrationDuration(step: { narrate: string }, index: number): number {
    const clip = this._config.narration?.get(index);
    if (clip) return clip.durationMs;
    const words = step.narrate.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1800, Math.round((words / 2.8) * 1000) + 400);
  }

  private async _executeNarrate(
    step: { narrate: string; wait?: boolean },
    index: number,
  ): Promise<StepResultTiming> {
    if (this._inSetup) {
      return { status: 'timing', stepIndex: index, stepType: 'narrate', duration: 0 };
    }
    const clip = this._config.narration?.get(index);
    const durationMs = this._narrationDuration(step, index);
    // Never talk over a previous line that is still playing (`wait: false`
    // lets actions continue under narration, not a second voice).
    const stillSpeaking = this._narrationBusyUntil - Date.now();
    if (stillSpeaking > 0) {
      await sleep(stillSpeaking);
    }
    this._narrationBusyUntil = Date.now() + durationMs + NARRATION_GAP_MS;
    this._narration.push({
      stepIndex: index,
      text: step.narrate,
      atMs: Date.now() - this._videoStart,
      durationMs,
      audioPath: clip?.audioPath,
    });
    if (step.wait !== false) {
      await sleep(durationMs + NARRATION_GAP_MS);
    }
    return {
      status: 'timing',
      stepIndex: index,
      stepType: 'narrate',
      duration: durationMs,
    };
  }

  private async _executeScreenshot(
    step: { screenshot: { name?: string; selector?: Selector; full_page?: boolean } },
    index: number,
  ): Promise<StepResultSuccess> {
    // Let in-flight requests and re-renders settle before capturing.
    // Apps that poll or animate never reach network-idle, so a short
    // timeout is treated as "settled enough", not an error.
    try {
      await this._browser.waitForNavigation?.({ networkIdle: true, timeout: 3000 });
    } catch {
      // Never settled — capture anyway.
    }
    await this._stage.setHidden(true);
    let buffer: Buffer;
    try {
      buffer = await this._browser.screenshot({
        element: step.screenshot.selector,
        fullPage: step.screenshot.full_page,
      });
    } finally {
      await this._stage.setHidden(false);
    }
    if (this._config.outputDir) {
      const dir = join(this._config.outputDir, 'screenshots');
      mkdirSync(dir, { recursive: true });
      const name = step.screenshot.name ?? `step-${index}`;
      const file = join(dir, `${name}.png`);
      writeFileSync(file, buffer);
      this._screenshots.push(file);
    }
    return this._success('screenshot', index);
  }

  private async _executePause(
    step: { pause: number },
    index: number,
  ): Promise<StepResultTiming> {
    await sleep(step.pause);
    return {
      status: 'timing',
      stepIndex: index,
      stepType: 'pause',
      duration: step.pause,
    };
  }

  private async _executeSetStorage(
    step: { set_storage: Record<string, string> },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.evaluate(
      `(() => { const e = ${JSON.stringify(step.set_storage)};` +
        ` for (const k of Object.keys(e)) localStorage.setItem(k, e[k]); })()`,
    );
    return this._success('set_storage', index);
  }

  private async _executeReload(index: number): Promise<StepResultSuccess> {
    await this._browser.reload();
    return this._success('reload', index);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private _success(stepType: string, index: number): StepResultSuccess {
    return {
      status: 'success',
      stepIndex: index,
      stepType,
      duration: Date.now() - this._startTime,
    };
  }

  private async _captureFailure(index: number): Promise<void> {
    if (!this._config.captureOnFailure || !this._config.outputDir) return;
    try {
      const dir = join(this._config.outputDir, 'failures');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `step-${index}.png`);
      writeFileSync(file, await this._browser.screenshot());
      this._log(`failure screenshot: ${file}`);
    } catch {
      // Page may already be gone.
    }
  }

  private _log(message: string): void {
    this._config.onLog?.(message);
  }

  private _getStepType(
    step: DemoScript['steps'][number],
  ): string {
    if (isGotoStep(step)) return 'goto';
    if (isClickStep(step)) return 'click';
    if (isHoverStep(step)) return 'hover';
    if (isFillStep(step)) return 'fill';
    if (isSelectStep(step)) return 'select';
    if (isPressStep(step)) return 'press';
    if (isScrollStep(step)) return 'scroll';
    if (isWaitForStep(step)) return 'wait_for';
    if (isNarrateStep(step)) return 'narrate';
    if (isScreenshotStep(step)) return 'screenshot';
    if (isMarkFlowStartStep(step)) return 'mark_flow_start';
    if (isMarkFlowEndStep(step)) return 'mark_flow_end';
    if (isPauseStep(step)) return 'pause';
    if (isSetStorageStep(step)) return 'set_storage';
    if (isReloadStep(step)) return 'reload';
    if (isDoneStep(step)) return 'done';
    return 'unknown';
  }

  private _isGlobalTimeout(): boolean {
    return Date.now() - this._startTime >= this._config.globalTimeout;
  }

  private _buildResult(status: 'success' | 'failure' | 'timeout'): RenderResult {
    return {
      steps: this._results,
      totalDuration: Date.now() - this._startTime,
      status,
      stepCount: this._results.length,
      outputDir: this._config.outputDir,
      warnings: [],
      cspDetected: this._cspDetected,
      narration: this._narration,
      contentStartMs: this._contentStartMs,
      screenshots: this._screenshots,
    };
  }
}
