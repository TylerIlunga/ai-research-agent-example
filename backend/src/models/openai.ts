import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config/env";
import type { Effort } from "./roles";

/**
 * The failover provider.
 *
 * OpenAI has no adaptive thinking and no `output_config.effort`, so the effort
 * a role asks for is mapped onto the levers that do exist: how much output the
 * model is allowed, and how deterministic it is. Planning and summarizing want
 * to be tight and repeatable; synthesis wants room and a little latitude.
 */
const EFFORT: Record<Effort, { temperature: number }> = {
  low: { temperature: 0 },
  medium: { temperature: 0.1 },
  high: { temperature: 0.3 },
  xhigh: { temperature: 0.3 },
  max: { temperature: 0.4 },
};

function requireKey(): string {
  const key = config.openai.apiKey;
  if (!key) {
    const error = new Error(
      "OPENAI_API_KEY is not configured. Add it to backend/.env and restart the server."
    );
    error.name = "MissingCredentials";
    throw error;
  }
  return key;
}

export function buildOpenAI(options: { maxTokens: number; effort: Effort }): ChatOpenAI {
  return new ChatOpenAI({
    model: config.openai.model,
    apiKey: requireKey(),
    // Role budgets are sized for Claude's 128K output ceiling. Most
    // OpenAI-compatible models cap far below that and reject the request
    // outright, so clamp rather than inherit.
    maxTokens: Math.min(options.maxTokens, config.openai.maxOutputTokens),
    temperature: EFFORT[options.effort].temperature,
    // A 429 for "no credits remaining" will never succeed. The SDK default of
    // six retries with backoff turns that into minutes of silence before the
    // user is told anything.
    maxRetries: config.maxRetries,
    ...(config.openai.baseUrl
      ? { configuration: { baseURL: config.openai.baseUrl } }
      : {}),
  });
}
