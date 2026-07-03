/**
 * DemoForge structured logger.
 *
 * Provides log levels: silent, error, info, warn, debug.
 * --verbose enables debug logging; --quiet suppresses non-error output.
 *
 * Usage:
 *   const logger = createLogger({ level: 'info' });
 *   logger.info('Hello');
 *   logger.debug('Debug info');  // only shown when level is 'debug'
 */

export type LogLevel = "silent" | "error" | "info" | "warn" | "debug";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** When true, output is JSON-formatted for structured logging. */
  json?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

/**
 * Create a logger instance.
 *
 * @param options - Logger configuration
 * @returns A logger object with level-based methods
 */
export function createLogger(options: LoggerOptions = {}): {
  level: LogLevel;
  setLevel(level: LogLevel): void;
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  log(entry: LogEntry): void;
} {
  let currentLevel: LogLevel = options.level ?? "info";

  function shouldLog(level: LogLevel): boolean {
    // Errors are always emitted regardless of level (CLI best practice)
    if (level === "error") return true;
    return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
  }

  function emit(entry: LogEntry): void {
    if (!shouldLog(entry.level)) return;

    if (options.json) {
      console.error(JSON.stringify(entry));
    } else {
      const prefix = `[demoforge]${entry.level !== "info" ? ` [${entry.level.toUpperCase()}]` : ""}`;
      const ts = new Date(entry.timestamp).toISOString();
      console.error(`${prefix} ${ts} - ${entry.message}`);
    }
  }

  return {
    get level(): LogLevel {
      return currentLevel;
    },
    setLevel(level: LogLevel): void {
      currentLevel = level;
    },
    error(message: string, context?: Record<string, unknown>): void {
      emit({ level: "error", message, timestamp: Date.now(), context });
    },
    warn(message: string, context?: Record<string, unknown>): void {
      emit({ level: "warn", message, timestamp: Date.now(), context });
    },
    info(message: string, context?: Record<string, unknown>): void {
      emit({ level: "info", message, timestamp: Date.now(), context });
    },
    debug(message: string, context?: Record<string, unknown>): void {
      emit({ level: "debug", message, timestamp: Date.now(), context });
    },
    log(entry: LogEntry): void {
      emit(entry);
    },
  };
}

/**
 * Create a silent logger that suppresses all output.
 */
export function createSilentLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: "silent" });
}

/**
 * Create a debug logger that shows all output.
 */
export function createDebugLogger(): ReturnType<typeof createLogger> {
  return createLogger({ level: "debug" });
}
