import crypto from "crypto";
import { existsSync } from "fs";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Which model provider is driving the agent.
 *
 * Anthropic is the design target. OpenAI is the hosted failover, and
 * `claude-code` shells out to the locally installed Claude Code CLI — a last
 * resort that needs no API key at all, at the cost of ~$0.15 and ~5s of
 * process startup per call.
 */
export type Provider = "anthropic" | "openai" | "claude-code" | "none";

/** Which search backend is answering queries. */
export type SearchProvider = "tavily" | "brave" | "searxng" | "none";

/**
 * How the research phase gathers evidence.
 *
 * `agentic` lets the model drive a tool loop. `direct` searches each planned
 * sub-question itself — no tool calling required, which is what makes weak or
 * tool-less providers (Claude Code CLI, most local models) usable.
 */
export type ResearchMode = "agentic" | "direct";

export interface Capabilities {
  reasoning: boolean;
  webSearch: boolean;
  memory: boolean;
}

const optionalString = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Model providers, in preference order.
  MODEL_PROVIDER: z.enum(["auto", "anthropic", "openai", "claude-code"]).default("auto"),
  MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  RESEARCH_MODE: z.enum(["auto", "agentic", "direct"]).default("auto"),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().trim().min(1).default("claude-opus-5"),

  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-4o-mini"),
  /** Any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, a gateway. */
  OPENAI_BASE_URL: optionalString,
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8_192),

  CLAUDE_CODE_BIN: z.string().trim().min(1).default("claude"),
  CLAUDE_CODE_MODEL: z.string().trim().min(1).default("opus"),

  // Search providers, in preference order.
  SEARCH_PROVIDER: z.enum(["auto", "tavily", "brave", "searxng"]).default("auto"),
  TAVILY_API_KEY: optionalString,
  BRAVE_API_KEY: optionalString,
  /** A SearXNG instance URL — the keyless option; run your own. */
  SEARXNG_URL: optionalString,
  SEARCH_BUDGET: z.coerce.number().int().min(1).max(12).default(5),
  RESULTS_PER_SEARCH: z.coerce.number().int().min(1).max(10).default(4),

  // Memory
  PINECONE_API_KEY: optionalString,
  PINECONE_INDEX: optionalString,
  PINECONE_INDEX_NAMESPACE: z.string().trim().default("research-agent"),
  EMBEDDING_MODEL: z.string().trim().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().optional().catch(undefined),

  /**
   * Whether keys may be supplied at runtime over the API. Convenient locally,
   * dangerous on a shared host — anyone who can reach the server could set the
   * credentials it spends with, so it is off outside development.
   */
  ALLOW_RUNTIME_KEYS: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === undefined ? undefined : value === "true"),

  // Secrets used by the security middleware
  JWT_SECRET: optionalString,
  MASTER_ENCRYPTION_KEY: optionalString,
  KEY_DERIVATION_SALT: optionalString,
});

type RawConfig = z.infer<typeof schema>;

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

/** Mutable so runtime-supplied keys can update it in place. */
const raw: RawConfig = parsed.data;
const isProduction = raw.NODE_ENV === "production";

const ephemeralSecrets: string[] = [];

function requireSecret(name: keyof RawConfig, value: string | undefined): string {
  if (value) return value;
  if (isProduction) {
    console.error(`Missing required environment variable in production: ${name}`);
    process.exit(1);
  }
  ephemeralSecrets.push(name);
  const generated = crypto.randomBytes(48).toString("hex");
  process.env[name] = generated;
  return generated;
}

const jwtSecret = requireSecret("JWT_SECRET", raw.JWT_SECRET);
const masterEncryptionKey = requireSecret("MASTER_ENCRYPTION_KEY", raw.MASTER_ENCRYPTION_KEY);
const keyDerivationSalt = requireSecret("KEY_DERIVATION_SALT", raw.KEY_DERIVATION_SALT);

/** Resolved once at boot, and again whenever a runtime key arrives. */
function claudeCodeAvailable(): boolean {
  const bin = raw.CLAUDE_CODE_BIN;
  if (bin.includes("/")) return existsSync(bin);
  // A bare name has to be found on PATH.
  return (process.env.PATH ?? "")
    .split(":")
    .some((dir) => dir && existsSync(`${dir}/${bin}`));
}

function resolveProvider(): Provider {
  const hasAnthropic = Boolean(raw.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(raw.OPENAI_API_KEY || raw.OPENAI_BASE_URL);
  const hasClaudeCode = claudeCodeAvailable();

  switch (raw.MODEL_PROVIDER) {
    case "anthropic":
      return hasAnthropic ? "anthropic" : "none";
    case "openai":
      return hasOpenAI ? "openai" : "none";
    case "claude-code":
      return hasClaudeCode ? "claude-code" : "none";
    default:
      // Claude Code is last: it is the most expensive per call, so it should
      // only carry the load when nothing cheaper is configured.
      if (hasAnthropic) return "anthropic";
      if (hasOpenAI) return "openai";
      if (hasClaudeCode) return "claude-code";
      return "none";
  }
}

function resolveSearchProvider(): SearchProvider {
  const has = {
    tavily: Boolean(raw.TAVILY_API_KEY),
    brave: Boolean(raw.BRAVE_API_KEY),
    searxng: Boolean(raw.SEARXNG_URL),
  };

  switch (raw.SEARCH_PROVIDER) {
    case "tavily":
      return has.tavily ? "tavily" : "none";
    case "brave":
      return has.brave ? "brave" : "none";
    case "searxng":
      return has.searxng ? "searxng" : "none";
    default:
      if (has.tavily) return "tavily";
      if (has.brave) return "brave";
      if (has.searxng) return "searxng";
      return "none";
  }
}

let provider: Provider = resolveProvider();
let searchProvider: SearchProvider = resolveSearchProvider();

export let capabilities: Capabilities = {
  reasoning: provider !== "none",
  webSearch: searchProvider !== "none",
  memory: Boolean(raw.PINECONE_API_KEY && raw.PINECONE_INDEX && raw.OPENAI_API_KEY),
};

function recompute(): void {
  provider = resolveProvider();
  searchProvider = resolveSearchProvider();
  capabilities = {
    reasoning: provider !== "none",
    webSearch: searchProvider !== "none",
    memory: Boolean(raw.PINECONE_API_KEY && raw.PINECONE_INDEX && raw.OPENAI_API_KEY),
  };
}

export const config = {
  env: raw.NODE_ENV,
  isProduction,
  isDevelopment: raw.NODE_ENV === "development",
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  maxRetries: raw.MODEL_MAX_RETRIES,

  get provider(): Provider {
    return provider;
  },
  get searchProvider(): SearchProvider {
    return searchProvider;
  },
  get capabilities(): Capabilities {
    return capabilities;
  },

  /** True when the provider was chosen explicitly rather than by the chain. */
  get providerPinned(): boolean {
    return raw.MODEL_PROVIDER !== "auto";
  },
  get searchPinned(): boolean {
    return raw.SEARCH_PROVIDER !== "auto";
  },

  /** True when a *preferred* provider was unavailable and something else stepped in. */
  get isFailover(): boolean {
    return raw.MODEL_PROVIDER === "auto" && provider !== "anthropic" && provider !== "none";
  },
  get isSearchFailover(): boolean {
    return raw.SEARCH_PROVIDER === "auto" && searchProvider !== "tavily" && searchProvider !== "none";
  },

  /** The model that will actually answer — for logs, health, and the UI. */
  get activeModel(): string {
    switch (provider) {
      case "anthropic":
        return raw.ANTHROPIC_MODEL;
      case "openai":
        return raw.OPENAI_MODEL;
      case "claude-code":
        return `claude-code (${raw.CLAUDE_CODE_MODEL})`;
      default:
        return "none";
    }
  },

  get researchMode(): ResearchMode {
    if (raw.RESEARCH_MODE !== "auto") return raw.RESEARCH_MODE;
    // The CLI provider exposes no tool calling, so it has to search directly.
    return provider === "claude-code" ? "direct" : "agentic";
  },

  get allowRuntimeKeys(): boolean {
    return raw.ALLOW_RUNTIME_KEYS ?? !isProduction;
  },

  anthropic: {
    get apiKey() {
      return raw.ANTHROPIC_API_KEY;
    },
    get model() {
      return raw.ANTHROPIC_MODEL;
    },
  },
  openai: {
    get apiKey() {
      return raw.OPENAI_API_KEY;
    },
    get model() {
      return raw.OPENAI_MODEL;
    },
    get baseUrl() {
      return raw.OPENAI_BASE_URL;
    },
    get maxOutputTokens() {
      return raw.OPENAI_MAX_OUTPUT_TOKENS;
    },
    get embeddingModel() {
      return raw.EMBEDDING_MODEL;
    },
    get embeddingDimensions() {
      return raw.EMBEDDING_DIMENSIONS;
    },
  },
  claudeCode: {
    get bin() {
      return raw.CLAUDE_CODE_BIN;
    },
    get model() {
      return raw.CLAUDE_CODE_MODEL;
    },
    get available() {
      return claudeCodeAvailable();
    },
  },
  search: {
    get tavilyKey() {
      return raw.TAVILY_API_KEY;
    },
    get braveKey() {
      return raw.BRAVE_API_KEY;
    },
    get searxngUrl() {
      return raw.SEARXNG_URL;
    },
    get budget() {
      return raw.SEARCH_BUDGET;
    },
    get resultsPerSearch() {
      return raw.RESULTS_PER_SEARCH;
    },
  },
  memory: {
    get apiKey() {
      return raw.PINECONE_API_KEY;
    },
    get index() {
      return raw.PINECONE_INDEX;
    },
    get namespace() {
      return raw.PINECONE_INDEX_NAMESPACE;
    },
  },
  secrets: {
    jwtSecret,
    masterEncryptionKey,
    keyDerivationSalt,
    ephemeral: ephemeralSecrets,
  },
} as const;

/** The credentials a client is allowed to set at runtime. */
export const RUNTIME_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "TAVILY_API_KEY",
  "BRAVE_API_KEY",
  "SEARXNG_URL",
] as const;

export type RuntimeKey = (typeof RUNTIME_KEYS)[number];

/**
 * Applies keys supplied at runtime. Held in memory only — nothing is written
 * to disk, so a restart returns to whatever `.env` says. Returns the names
 * that changed so the caller can log without ever handling the values.
 */
export function applyRuntimeKeys(updates: Partial<Record<RuntimeKey, string | null>>): RuntimeKey[] {
  const changed: RuntimeKey[] = [];

  for (const key of RUNTIME_KEYS) {
    if (!(key in updates)) continue;
    const value = updates[key];
    const next = value === null || value === undefined || value === "" ? undefined : value.trim();
    if (raw[key] === next) continue;
    raw[key] = next;
    changed.push(key);
  }

  if (changed.length > 0) recompute();
  return changed;
}

/** Human-readable notes about anything running in a degraded mode. */
export function configWarnings(): string[] {
  const warnings: string[] = [];

  if (provider === "none") {
    warnings.push(
      raw.MODEL_PROVIDER === "auto"
        ? "No model provider is configured — set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY, or install the Claude Code CLI."
        : `MODEL_PROVIDER is pinned to "${raw.MODEL_PROVIDER}" but that provider is not available.`
    );
  } else if (provider === "openai" && config.isFailover) {
    warnings.push(
      `ANTHROPIC_API_KEY is not set — running on the OpenAI failover (${raw.OPENAI_MODEL}).`
    );
  } else if (provider === "claude-code") {
    warnings.push(
      "Running on the Claude Code CLI failover — no API key needed, but each call costs ~$0.15 and ~5s of startup, so research runs in direct mode."
    );
  }

  if (searchProvider === "none") {
    warnings.push(
      "No search provider is configured — set TAVILY_API_KEY, BRAVE_API_KEY, or SEARXNG_URL. The agent will answer from model knowledge without citing live sources."
    );
  } else if (config.isSearchFailover) {
    warnings.push(`TAVILY_API_KEY is not set — searching with ${searchProvider} instead.`);
  }

  if (!capabilities.memory) {
    warnings.push(
      "Pinecone or OpenAI credentials are missing — long-term memory is disabled (research is unaffected)."
    );
  }
  if (ephemeralSecrets.length > 0) {
    warnings.push(
      `Generated ephemeral development secrets for ${ephemeralSecrets.join(", ")} — sessions reset on restart.`
    );
  }
  return warnings;
}
