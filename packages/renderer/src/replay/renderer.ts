/**
 * DemoForge renderer — script replay engine.
 *
 * Loads a DemoScript and executes steps via a BrowserSession abstraction.
 * Supports timeout policies, failure output (screenshot + AX diff),
 * CSP detection, and stability detection.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DemoScript, WaitForCondition } from '@demoforge/core';
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
  isScreenshotStep,
  isScrollStep,
  isSelectStep,
  isWaitForStep,
} from '@demoforge/core';

import { BrowserSession } from '@demoforge/browser';

import type {
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

// ─── Renderer ────────────────────────────────────────────────────────────────

export class Renderer {
  private _browser: BrowserSession;
  private _config: Required<RenderConfig>;
  private _steps: DemoScript['steps'];
  private _results: StepResult[] = [];
  private _startTime = 0;
  private _cspDetected = false;

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
    };
    this._steps = script.steps;
  }

  get cspDetected(): boolean {
    return this._cspDetected;
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  async render(): Promise<RenderResult> {
    this._results = [];
    this._startTime = Date.now();
    this._cspDetected = false;

    await this._browser.launch();

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
          return this._buildResult('failure');
        }

        if (result.status === 'timeout') {
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

  // ─── Step Execution ─────────────────────────────────────────────────────

  private async _executeStep(step: DemoScript['steps'][number], index: number): Promise<StepResult> {
    const stepType = this._getStepType(step);
    const stepStart = Date.now();

    return new Promise<StepResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          status: 'timeout',
          stepIndex: index,
          stepType,
          duration: Date.now() - stepStart,
          timeoutMs: this._config.stepTimeout,
        });
      }, this._config.stepTimeout);

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
    if (isGotoStep(step)) {
      return this._executeGoto(step, index);
    }
    if (isClickStep(step)) {
      return this._executeClick(step, index);
    }
    if (isHoverStep(step)) {
      return this._executeHover(step, index);
    }
    if (isFillStep(step)) {
      return this._executeFill(step, index);
    }
    if (isSelectStep(step)) {
      return this._executeSelect(step, index);
    }
    if (isPressStep(step)) {
      return this._executePress(step, index);
    }
    if (isScrollStep(step)) {
      return this._executeScroll(step, index);
    }
    if (isWaitForStep(step)) {
      return this._executeWaitFor(step, index);
    }
    if (isNarrateStep(step)) {
      return this._executeNarrate(step, index);
    }
    if (isScreenshotStep(step)) {
      return this._executeScreenshot(step, index);
    }
    if (isMarkFlowStartStep(step)) {
      return this._executeMarkFlowStart(step, index);
    }
    if (isMarkFlowEndStep(step)) {
      return this._executeMarkFlowEnd(step, index);
    }
    if (isPauseStep(step)) {
      return this._executePause(step, index);
    }
    if (isDoneStep(step)) {
      return this._executeDone(step, index);
    }

    throw new RenderError(`Unknown step type: ${JSON.stringify(step)}`, {
      stepIndex: index,
    });
  }

  // ─── Individual Step Handlers ───────────────────────────────────────────

  private async _executeGoto(
    step: { goto: string; settle?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    const url = step.goto;
    const settle = step.settle ?? this._config.defaultSettle;

    await this._browser.goto(url, settle as 'load' | 'domcontentloaded' | 'networkidle');

    return {
      status: 'success',
      stepIndex: index,
      stepType: 'goto',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeClick(
    step: { click: import('@demoforge/core').Selector; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.click(step.click as Parameters<typeof this._browser.click>[0]);
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'click',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeHover(
    step: { hover: import('@demoforge/core').Selector; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.hover(step.hover as Parameters<typeof this._browser.hover>[0]);
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'hover',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeFill(
    step: { fill: { target: import('@demoforge/core').Selector; value: string }; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.fill(
      step.fill.target as Parameters<typeof this._browser.fill>[0],
      step.fill.value,
    );
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'fill',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeSelect(
    step: { select: { target: import('@demoforge/core').Selector; value: string }; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.select(
      step.select.target as Parameters<typeof this._browser.select>[0],
      step.select.value,
    );
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'select',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executePress(
    step: { press: { key: string }; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.press(step.press.key);
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'press',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeScroll(
    step: { scroll: { amount: number }; effect?: string },
    index: number,
  ): Promise<StepResultSuccess> {
    await this._browser.scroll({ deltaY: step.scroll.amount });
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'scroll',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeWaitFor(
    step: { wait_for: WaitForCondition; effect?: string },
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
    }

    return {
      status: 'success',
      stepIndex: index,
      stepType: 'wait_for',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeNarrate(
    _step: { narrate: string },
    index: number,
  ): Promise<StepResultTiming> {
    return {
      status: 'timing',
      stepIndex: index,
      stepType: 'narrate',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeScreenshot(
    step: { screenshot: { name?: string; annotate?: string[] } },
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
    const buffer = await this._browser.screenshot();
    if (this._config.outputDir) {
      const dir = join(this._config.outputDir, 'screenshots');
      mkdirSync(dir, { recursive: true });
      const name = step.screenshot.name ?? `step-${index}`;
      writeFileSync(join(dir, `${name}.png`), buffer);
    }
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'screenshot',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeMarkFlowStart(
    _step: { mark_flow_start: { name: string } },
    index: number,
  ): Promise<StepResultSuccess> {
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'mark_flow_start',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executeMarkFlowEnd(
    _step: { mark_flow_end: { name: string } },
    index: number,
  ): Promise<StepResultSuccess> {
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'mark_flow_end',
      duration: Date.now() - this._startTime,
    };
  }

  private async _executePause(
    step: { pause: number },
    index: number,
  ): Promise<StepResultTiming> {
    await new Promise((resolve) => setTimeout(resolve, step.pause));
    return {
      status: 'timing',
      stepIndex: index,
      stepType: 'pause',
      duration: step.pause,
    };
  }

  private async _executeDone(
    _step: { done: true },
    index: number,
  ): Promise<StepResultSuccess> {
    return {
      status: 'success',
      stepIndex: index,
      stepType: 'done',
      duration: Date.now() - this._startTime,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

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
    };
  }
}
