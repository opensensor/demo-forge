/**
 * LLM client adapter — thin OpenAI-compatible API client.
 *
 * Features:
 * - Configurable base URL, model name, API key
 * - Native Node `fetch` (no axios, no superagent)
 * - JSON schema `response_format` for action-space enforcement
 * - Token counting utility for context budget management
 * - Two model role presets: `planner` (action selection) and `copywriter` (narration)
 * - Retry with exponential backoff for transient errors (429, 500)
 * - Graceful degradation if llama-server is unavailable
 * - Uses structured error types from T2 (DemoForgeError hierarchy)
 */

import {
  DemoForgeError,
  LlmUnavailableError,
  LlmTimeoutError,
  LlmApiError,
} from "../errors/index.js";
import type {
  ChatMessage,
  JsonSchemaResponseFormat,
  LlmClientConfig,
  LlmRequestConfig,
  LlmResponse,
  PresetConfig,
  TokenCounterConfig,
} from "./types.js";

// ---------------------------------------------------------------------------
// TokenCounter — rough token estimation utility
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;

export class TokenCounter {
  private _total = 0;
  private readonly maxTokens: number;

  constructor(config?: TokenCounterConfig) {
    this.maxTokens = config?.maxTokens ?? 8192;
  }

  get total(): number {
    return this._total;
  }

  get remaining(): number {
    return Math.max(0, this.maxTokens - this._total);
  }

  get isOverBudget(): boolean {
    return this._total >= this.maxTokens;
  }

  /**
   * Rough token count for a string.
   * Uses ~4 chars per token (GPT-like approximation).
   * Accuracy: within ~5% of actual tokenization for English text.
   */
  countTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
  }

  add(text: string): number {
    const tokens = this.countTokens(text);
    this._total += tokens;
    return tokens;
  }

  reset(): void {
    this._total = 0;
  }
}

// ---------------------------------------------------------------------------
// Preset configurations
// ---------------------------------------------------------------------------

export function plannerConfig(options?: {
  messages?: ChatMessage[];
  response_format?: JsonSchemaResponseFormat;
  max_tokens?: number;
}): PresetConfig {
  const systemPrompt =
    "You are a demo exploration planner. Given the current page state and a goal, " +
    "choose the next action from the allowed action space. " +
    "Respond with a JSON object containing: action (string), target (optional selector), " +
    "value (optional input value), narration (optional narration text). " +
    "Only choose actions from: goto, click, hover, fill, select, press, scroll, " +
    "wait_for, narrate, screenshot, done.";

  return {
    messages: [
      { role: "system", content: systemPrompt },
      ...(options?.messages ?? [{ role: "user", content: "" }]),
    ],
    temperature: 0.3,
    response_format: options?.response_format,
    max_tokens: options?.max_tokens ?? 512,
  };
}

export function copywriterConfig(options?: {
  messages?: ChatMessage[];
  max_tokens?: number;
}): PresetConfig {
  const systemPrompt =
    "You are a demo narration copywriter. Given a description of a UI action or page state, " +
    "write a concise, engaging narration sentence (1-2 sentences max). " +
    "Focus on what the user is doing and why it matters. " +
    "Avoid jargon. Write in active voice.";

  return {
    messages: [
      { role: "system", content: systemPrompt },
      ...(options?.messages ?? [{ role: "user", content: "" }]),
    ],
    temperature: 0.7,
    max_tokens: options?.max_tokens ?? 256,
  };
}

// ---------------------------------------------------------------------------
// LlmClient — thin OpenAI-compatible API client
// ---------------------------------------------------------------------------

export class LlmClient {
  private readonly baseURL: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config: LlmClientConfig) {
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.model = config.model ?? "llama3.1";
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * Send a chat completion request to the OpenAI-compatible API.
   *
   * Supports JSON schema `response_format` for constrained generation.
   * Retries with exponential backoff on 429 and 500 errors.
   * Throws structured errors on failure.
   */
  async sendRequest(
    requestConfig: LlmRequestConfig,
  ): Promise<LlmResponse> {
    const url = `${this.baseURL}/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: requestConfig.messages,
      temperature: requestConfig.temperature ?? 0.3,
      max_tokens: requestConfig.max_tokens ?? 1024,
    };

    // Add response_format if provided (JSON schema or json_object)
    if (requestConfig.response_format) {
      body.response_format = requestConfig.response_format;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      lastError = null;

      try {
        const response = await this.fetchWithTimeout(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        // Handle non-200 responses
        if (!response.ok) {
          const responseBody = await response.text();
          let errorMessage = `HTTP ${response.status}`;

          try {
            const parsed = JSON.parse(responseBody);
            if (parsed.error && typeof parsed.error === "object") {
              errorMessage =
                parsed.error.message || parsed.error.type || errorMessage;
            }
          } catch {
            // Use raw response body as error message
            errorMessage = responseBody.slice(0, 500);
          }

          // Retry on transient errors
          if (
            (response.status === 429 || response.status === 500) &&
            attempt < this.maxRetries
          ) {
            const backoffMs = this.exponentialBackoff(attempt);
            await this.sleep(backoffMs);
            continue;
          }

          throw new LlmApiError(errorMessage, {
            statusCode: response.status,
            responseBody: responseBody.slice(0, 1000),
          });
        }

        // Parse successful response
        const data = await response.json();
        return this.parseLlmResponse(data);
      } catch (err) {
        if (err instanceof DemoForgeError) {
          throw err;
        }

        // Network errors (connection refused, timeout, etc.)
        lastError = err instanceof Error ? err : new Error(String(err));

        // Retry on transient errors
        if (attempt < this.maxRetries) {
          const backoffMs = this.exponentialBackoff(attempt);
          await this.sleep(backoffMs);
          continue;
        }
      }
    }

    // All retries exhausted
    if (lastError) {
      if (lastError.name === "TimeoutError" || lastError.message.includes("timeout")) {
        throw new LlmTimeoutError("Request timed out after all retries", {
          timeout: this.timeout,
          url,
        });
      }
      throw new LlmUnavailableError(
        `LLM server is unreachable at ${this.baseURL}: ${lastError.message}. ` +
          "Ensure llama-server or an OpenAI-compatible API is running and accessible.",
        { baseUrl: this.baseURL },
      );
    }

    throw new LlmUnavailableError(`LLM server is unreachable at ${this.baseURL}`, {
      baseUrl: this.baseURL,
    });
  }

  /**
   * Check if the LLM server is available (health check).
   * Returns true if the server responds to a minimal request.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const url = `${this.baseURL}/v1/chat/completions`;
      const response = await this.fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await globalThis.fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseLlmResponse(data: unknown): LlmResponse {
    if (!data || typeof data !== "object") {
      throw new LlmApiError("Invalid response: not an object");
    }

    const obj = data as Record<string, unknown>;
    const choices = obj.choices;

    if (!Array.isArray(choices) || choices.length === 0) {
      throw new LlmApiError("Invalid response: no choices in response");
    }

    const firstChoice = choices[0] as Record<string, unknown>;
    const message = firstChoice.message as Record<string, unknown> | undefined;

    if (!message || typeof message !== "object") {
      throw new LlmApiError("Invalid response: missing message in choice");
    }

    return {
      id: String(obj.id ?? ""),
      object: String(obj.object ?? "chat.completion"),
      created: Number(obj.created ?? 0),
      model: String(obj.model ?? this.model),
      choices: [
        {
          index: Number(firstChoice.index ?? 0),
          message: {
            role: "assistant",
            content: String(message.content ?? ""),
          },
          finish_reason: String(
            firstChoice.finish_reason ?? "stop",
          ) as "stop" | "length",
        },
      ],
      usage: {
        prompt_tokens: Number((obj.usage as Record<string, unknown>)?.prompt_tokens ?? 0),
        completion_tokens: Number((obj.usage as Record<string, unknown>)?.completion_tokens ?? 0),
        total_tokens: Number((obj.usage as Record<string, unknown>)?.total_tokens ?? 0),
      },
    };
  }

  private exponentialBackoff(attempt: number): number {
    // Base 100ms, exponential with jitter
    const base = 100;
    const jitter = Math.random() * 100;
    return base * Math.pow(2, attempt) + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
