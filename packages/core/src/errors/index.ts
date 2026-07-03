/**
 * DemoForge error types.
 *
 * All errors extend DemoForgeError and carry a `demoforge: true` marker
 * so callers can catch framework errors with a single handler.
 */

export interface DemoForgeErrorOptions {
  demoforge: true;
}

export class DemoForgeError extends Error {
  demoforge = true as const;

  constructor(message: string) {
    super(message);
    this.name = "DemoForgeError";
    Object.setPrototypeOf(this, DemoForgeError.prototype);
  }
}

export interface ValidationErrorOptions {
  issues?: Array<{ path: string[]; message: string }>;
}

export class ValidationError extends DemoForgeError {
  override name = "ValidationError";
  issues?: Array<{ path: string[]; message: string }>;

  constructor(message: string, options?: ValidationErrorOptions) {
    super(message);
    this.issues = options?.issues;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export interface RenderErrorOptions {
  stepIndex?: number;
  stepType?: string;
}

export class RenderError extends DemoForgeError {
  override name = "RenderError";
  stepIndex?: number;
  stepType?: string;

  constructor(message: string, options?: RenderErrorOptions) {
    super(message);
    this.stepIndex = options?.stepIndex;
    this.stepType = options?.stepType;
    Object.setPrototypeOf(this, RenderError.prototype);
  }
}

export interface ExplorerErrorOptions {
  turn?: number;
  budgetExceeded?: string;
}

export class ExplorerError extends DemoForgeError {
  override name = "ExplorerError";
  turn?: number;
  budgetExceeded?: string;

  constructor(message: string, options?: ExplorerErrorOptions) {
    super(message);
    this.turn = options?.turn;
    this.budgetExceeded = options?.budgetExceeded;
    Object.setPrototypeOf(this, ExplorerError.prototype);
  }
}

export interface HealErrorOptions {
  oldSelector?: string;
  newSelector?: string;
  reason?: string;
}

export class HealError extends DemoForgeError {
  override name = "HealError";
  oldSelector?: string;
  newSelector?: string;
  reason?: string;

  constructor(message: string, options?: HealErrorOptions) {
    super(message);
    this.oldSelector = options?.oldSelector;
    this.newSelector = options?.newSelector;
    this.reason = options?.reason;
    Object.setPrototypeOf(this, HealError.prototype);
  }
}

export interface ConfigErrorOptions {
  path?: string;
}

export class ConfigError extends DemoForgeError {
  override name = "ConfigError";
  path?: string;

  constructor(message: string, options?: ConfigErrorOptions) {
    super(message);
    this.path = options?.path;
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

export interface LlmUnavailableErrorOptions {
  baseUrl?: string;
}

export class LlmUnavailableError extends DemoForgeError {
  override name = "LlmUnavailableError";
  baseUrl?: string;

  constructor(message: string, options?: LlmUnavailableErrorOptions) {
    super(message);
    this.baseUrl = options?.baseUrl;
    Object.setPrototypeOf(this, LlmUnavailableError.prototype);
  }
}

export interface LlmTimeoutErrorOptions {
  timeout?: number;
  url?: string;
}

export class LlmTimeoutError extends DemoForgeError {
  override name = "LlmTimeoutError";
  timeout?: number;
  url?: string;

  constructor(message: string, options?: LlmTimeoutErrorOptions) {
    super(message);
    this.timeout = options?.timeout;
    this.url = options?.url;
    Object.setPrototypeOf(this, LlmTimeoutError.prototype);
  }
}

export interface LlmApiErrorOptions {
  statusCode?: number;
  responseBody?: string;
}

export class LlmApiError extends DemoForgeError {
  override name = "LlmApiError";
  statusCode?: number;
  responseBody?: string;

  constructor(message: string, options?: LlmApiErrorOptions) {
    super(message);
    this.statusCode = options?.statusCode;
    this.responseBody = options?.responseBody;
    Object.setPrototypeOf(this, LlmApiError.prototype);
  }
}

export interface SeedErrorOptions {
  command?: string;
  exitCode?: number | null;
  timeoutMs?: number;
  stdout?: string;
  stderr?: string;
  attempts?: number;
}

export class SeedError extends DemoForgeError {
  override name = "SeedError";
  command?: string;
  exitCode?: number | null;
  timeoutMs?: number;
  stdout?: string;
  stderr?: string;
  attempts?: number;

  constructor(message: string, options?: SeedErrorOptions) {
    super(message);
    this.command = options?.command;
    this.exitCode = options?.exitCode;
    this.timeoutMs = options?.timeoutMs;
    this.stdout = options?.stdout;
    this.stderr = options?.stderr;
    this.attempts = options?.attempts;
    Object.setPrototypeOf(this, SeedError.prototype);
  }
}
