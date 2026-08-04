import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { buildClaude } from "./claude";
import { buildClaudeCode } from "./claudeCode";
import { buildOpenAI } from "./openai";
import { ROLES, type Role } from "./roles";

export type { Effort, Role } from "./roles";

/**
 * What a provider can actually do, beyond answering.
 *
 * These drive real decisions in the graph: whether the research phase can use
 * a model-driven tool loop, and whether it is affordable to summarize every
 * fetched page. Getting them wrong is the difference between a 2-call run and
 * a 12-call one.
 */
export interface ProviderTraits {
  /** Native tool calling. Without it the agent must search directly. */
  toolCalling: boolean;
  /** Cheap enough to call once per fetched page. */
  bulkSummarization: boolean;
  label: string;
}

const TRAITS: Record<string, ProviderTraits> = {
  anthropic: { toolCalling: true, bulkSummarization: true, label: "Anthropic" },
  openai: { toolCalling: true, bulkSummarization: true, label: "OpenAI" },
  // Per-invocation cost and startup make bulk summarization untenable, and the
  // CLI exposes no tool-calling interface.
  "claude-code": { toolCalling: false, bulkSummarization: false, label: "Claude Code CLI" },
  none: { toolCalling: false, bulkSummarization: false, label: "none" },
};

export function providerTraits(): ProviderTraits {
  return TRAITS[config.provider] ?? TRAITS.none;
}

/**
 * The agent asks for a role, not a provider. The graph, the tools, and the
 * prompts are identical whichever model answers.
 *
 * Models are built lazily and memoized, so importing this module needs no
 * credentials — and the cache is cleared when runtime keys change the
 * provider underneath us.
 */
const cache = new Map<Role, BaseChatModel>();
let cachedFor: string = config.provider;

function forRole(role: Role): BaseChatModel {
  if (cachedFor !== config.provider) {
    cache.clear();
    cachedFor = config.provider;
  }

  const existing = cache.get(role);
  if (existing) return existing;

  const spec = ROLES[role];
  let model: BaseChatModel;

  switch (config.provider) {
    case "anthropic":
      model = buildClaude(spec);
      break;
    case "openai":
      model = buildOpenAI(spec);
      break;
    case "claude-code":
      model = buildClaudeCode();
      break;
    default: {
      const error = new Error(
        "No model provider is configured. Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY, or install the Claude Code CLI."
      );
      error.name = "MissingCredentials";
      throw error;
    }
  }

  logger.debug("Model built", { role, provider: config.provider, model: config.activeModel });
  cache.set(role, model);
  return model;
}

/** Drops memoized models so the next call rebuilds against new credentials. */
export function resetModelCache(): void {
  cache.clear();
  cachedFor = config.provider;
}

export const plannerModel = () => forRole("planner");
export const researchModel = () => forRole("research");
export const synthesisModel = () => forRole("synthesis");
export const summaryModel = () => forRole("summary");

/**
 * Message content arrives as a plain string from some providers and as an
 * array of blocks from others (Anthropic's adaptive thinking emits thinking
 * blocks alongside text). Collapse both to the visible text.
 */
export function textOf(message: BaseMessage | { content: unknown }): string {
  const content = message.content as unknown;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "type" in block) {
        const typed = block as { type: string; text?: string };
        if (typed.type === "text" && typeof typed.text === "string") return typed.text;
      }
      return "";
    })
    .join("");
}
