import { ChatAnthropic } from "@langchain/anthropic";
import { config } from "../config/env";
import type { Effort } from "./roles";

/**
 * Claude Opus 5 rejects `temperature`, `top_p` and `top_k`, and it does not
 * accept the `{type: "enabled", budget_tokens}` thinking shape. `ChatAnthropic`
 * still sends all four: sampling parameters default to sentinel `-1`/`1`
 * values, and its thinking config only models the pre-4.6 shapes.
 *
 * Rather than fight the constructor, we strip them on the way out and inject
 * the parameters Opus 5 actually wants. Everything else — message formatting,
 * tool binding, streaming, usage accounting — is left to the framework.
 */
class Claude extends ChatAnthropic {
  private readonly effort: Effort;

  constructor(fields: { model: string; apiKey: string; maxTokens: number; effort: Effort }) {
    super({
      model: fields.model,
      apiKey: fields.apiKey,
      maxTokens: fields.maxTokens,
      maxRetries: config.maxRetries,
      // Kept for interface compatibility; stripped again below.
      temperature: 1,
    });
    this.effort = fields.effort;
  }

  invocationParams(
    options?: Parameters<ChatAnthropic["invocationParams"]>[0]
  ): ReturnType<ChatAnthropic["invocationParams"]> {
    const params = super.invocationParams(options) as Record<string, unknown>;

    delete params.temperature;
    delete params.top_k;
    delete params.top_p;

    // Adaptive thinking, always. Disabling it on Opus 5 is only legal at
    // effort <= high and brings two failure modes (tool calls emitted as plain
    // text, internal tags leaking into output) that low effort avoids anyway.
    params.thinking = { type: "adaptive" };
    params.output_config = { effort: this.effort };

    return params as ReturnType<ChatAnthropic["invocationParams"]>;
  }
}

function requireKey(): string {
  const key = config.anthropic.apiKey;
  if (!key) {
    const error = new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to backend/.env and restart the server."
    );
    error.name = "MissingCredentials";
    throw error;
  }
  return key;
}

export function buildClaude(options: { maxTokens: number; effort: Effort }): Claude {
  return new Claude({
    model: config.anthropic.model,
    apiKey: requireKey(),
    maxTokens: options.maxTokens,
    effort: options.effort,
  });
}
