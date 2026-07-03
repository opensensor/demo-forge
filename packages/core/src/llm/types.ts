/**
 * LLM client adapter types.
 *
 * Defines the interfaces and types used by the OpenAI-compatible API client.
 */

/** A message in a conversation. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** JSON schema response format for constrained generation. */
export interface JsonSchemaResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

/** Generic response format (OpenAI-compatible). */
export type ResponseFormat = { type: "json_object" } | JsonSchemaResponseFormat;

/** Configuration for a single LLM request. */
export interface LlmRequestConfig {
  messages: ChatMessage[];
  response_format?: ResponseFormat;
  temperature?: number;
  max_tokens?: number;
}

/** LLM response choice. */
export interface LlmChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length";
}

/** LLM usage statistics. */
export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** LLM API response (OpenAI-compatible format). */
export interface LlmResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LlmChoice[];
  usage: LlmUsage;
}

/** LLM client configuration. */
export interface LlmClientConfig {
  /** Base URL of the OpenAI-compatible API (e.g., http://localhost:8080/v1). */
  baseURL: string;
  /** Model name to use. */
  model?: string;
  /** API key for authentication. */
  apiKey?: string;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Maximum number of retries for transient errors. */
  maxRetries?: number;
}

/** Token counter configuration. */
export interface TokenCounterConfig {
  /** Maximum token budget. */
  maxTokens: number;
}

/** Preset configuration factory return type. */
export interface PresetConfig {
  messages: ChatMessage[];
  temperature?: number;
  response_format?: ResponseFormat;
  max_tokens?: number;
}
