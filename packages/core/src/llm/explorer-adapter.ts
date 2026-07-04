/**
 * DemoForge LLM — adapter between the OpenAI-compatible HTTP client and the
 * ExplorerAgent's action-oriented LLM interface.
 *
 * The explorer speaks `sendAction(systemPrompt, messages, actionSchema)` and
 * expects a parsed action object back; the HTTP client speaks raw chat
 * completions. This adapter bridges the two, including defensive parsing for
 * local models that wrap JSON in markdown fences or emit reasoning tags.
 */

import { LlmClient as HttpLlmClient } from "./client.js";
import type { JsonSchemaResponseFormat } from "./types.js";
import type {
  LlmClient as ExplorerLlmClient,
  LlmActionResponse,
} from "../explorer/types.js";

export interface ExplorerAdapterOptions {
  /** Sampling temperature for action selection. Default: 0.2. */
  temperature?: number;
  /** Max tokens per action response. Default: 1024. */
  maxTokens?: number;
}

/**
 * Extract a JSON object from raw model output. Tolerates `<think>...</think>`
 * reasoning blocks, markdown code fences, and leading/trailing prose.
 */
export function extractActionJson(content: string): Record<string, unknown> {
  let text = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1")
    .trim();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Fall back to the outermost {...} span
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      text = text.slice(start, end + 1);
      return JSON.parse(text) as Record<string, unknown>;
    }
    throw new Error(`LLM returned no parseable JSON action: ${content.slice(0, 200)}`);
  }
}

/**
 * Wrap an HTTP LlmClient so it satisfies the explorer's LlmClient interface.
 */
export function createExplorerLlmAdapter(
  client: HttpLlmClient,
  options?: ExplorerAdapterOptions,
): ExplorerLlmClient {
  return {
    async sendAction(systemPrompt, messages, actionSchema) {
      const baseTokens = options?.maxTokens ?? 2048;
      let lastFinishReason = "";

      // Reasoning models can burn the whole token budget on hidden reasoning
      // and return empty content (finish_reason "length"). Retry once with a
      // doubled budget before giving up.
      for (const maxTokens of [baseTokens, Math.min(baseTokens * 2, 16384)]) {
        const response = await client.sendRequest({
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          response_format: {
            type: "json_schema",
            json_schema: actionSchema as JsonSchemaResponseFormat["json_schema"],
          },
          temperature: options?.temperature ?? 0.2,
          max_tokens: maxTokens,
        });

        const choice = response.choices[0];
        lastFinishReason = choice?.finish_reason ?? "unknown";
        const content = choice?.message?.content ?? "";
        if (!content.trim()) continue;

        const parsed = extractActionJson(content);
        if (typeof parsed.action !== "string") {
          throw new Error(
            `LLM action response missing "action" field: ${content.slice(0, 200)}`,
          );
        }
        return parsed as unknown as LlmActionResponse;
      }

      throw new Error(
        `LLM returned empty content twice (finish_reason=${lastFinishReason}). ` +
          `If this is a reasoning model, raise the adapter maxTokens.`,
      );
    },
  };
}
