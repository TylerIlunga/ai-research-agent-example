/**
 * The provider chains are the product's availability story, so their
 * resolution order is pinned by test.
 *
 * env.ts reads process.env at import time (and dotenv fills only *unset*
 * vars), so every scenario sets each relevant variable explicitly — an empty
 * string parses as "absent" through the `optionalString` schema — and loads a
 * fresh module instance.
 */

const BASE_ENV = {
  NODE_ENV: "test",
  MODEL_PROVIDER: "auto",
  SEARCH_PROVIDER: "auto",
  RESEARCH_MODE: "auto",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  OPENAI_BASE_URL: "",
  // A path that cannot exist, so the CLI leg of the chain is deterministic.
  CLAUDE_CODE_BIN: "/nonexistent/claude-code-for-tests",
  TAVILY_API_KEY: "",
  BRAVE_API_KEY: "",
  SEARXNG_URL: "",
  PINECONE_API_KEY: "",
  PINECONE_INDEX: "",
} as const;

const ORIGINAL_ENV = process.env;

function loadConfig(overrides: Partial<Record<keyof typeof BASE_ENV, string>> = {}) {
  process.env = { ...ORIGINAL_ENV, ...BASE_ENV, ...overrides };
  let loaded: typeof import("../config/env") | undefined;
  jest.isolateModules(() => {
    loaded = require("../config/env") as typeof import("../config/env");
  });
  if (!loaded) throw new Error("config module failed to load");
  return loaded;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("model provider chain", () => {
  it("prefers Anthropic when its key is present", () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" });
    expect(config.provider).toBe("anthropic");
    expect(config.isFailover).toBe(false);
  });

  it("falls over to OpenAI when Anthropic is missing", () => {
    const { config } = loadConfig({ OPENAI_API_KEY: "sk-test" });
    expect(config.provider).toBe("openai");
    expect(config.isFailover).toBe(true);
  });

  it("accepts an OpenAI-compatible base url in place of a key", () => {
    const { config } = loadConfig({ OPENAI_BASE_URL: "http://localhost:11434/v1" });
    expect(config.provider).toBe("openai");
  });

  it("resolves to none when no provider is available", () => {
    const { config } = loadConfig();
    expect(config.provider).toBe("none");
    expect(config.capabilities.reasoning).toBe(false);
    expect(config.activeModel).toBe("none");
  });

  it("reports a pinned provider without credentials as none, not a silent fall-through", () => {
    const { config } = loadConfig({ MODEL_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-test" });
    expect(config.provider).toBe("none");
    expect(config.providerPinned).toBe(true);
  });

  it("never reports a pinned provider as a failover", () => {
    const { config } = loadConfig({ MODEL_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
    expect(config.provider).toBe("openai");
    expect(config.isFailover).toBe(false);
  });

  it("exposes the configured Anthropic model as the active model", () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(config.activeModel).toBe(process.env.ANTHROPIC_MODEL ?? "claude-opus-5");
  });
});

describe("search provider chain", () => {
  it("prefers Tavily, then Brave, then SearXNG", () => {
    expect(
      loadConfig({ TAVILY_API_KEY: "t", BRAVE_API_KEY: "b", SEARXNG_URL: "http://sx" }).config
        .searchProvider
    ).toBe("tavily");
    expect(
      loadConfig({ BRAVE_API_KEY: "b", SEARXNG_URL: "http://sx" }).config.searchProvider
    ).toBe("brave");
    expect(loadConfig({ SEARXNG_URL: "http://sx" }).config.searchProvider).toBe("searxng");
  });

  it("resolves to none and drops the webSearch capability when nothing is configured", () => {
    const { config } = loadConfig();
    expect(config.searchProvider).toBe("none");
    expect(config.capabilities.webSearch).toBe(false);
  });

  it("flags a non-Tavily auto resolution as a search failover", () => {
    const { config } = loadConfig({ BRAVE_API_KEY: "b" });
    expect(config.isSearchFailover).toBe(true);
  });
});

describe("research mode", () => {
  it("is agentic for tool-calling providers", () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(config.researchMode).toBe("agentic");
  });

  it("honours an explicit override", () => {
    const { config } = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test", RESEARCH_MODE: "direct" });
    expect(config.researchMode).toBe("direct");
  });
});

describe("memory capability", () => {
  it("requires Pinecone and OpenAI credentials together", () => {
    expect(loadConfig().config.capabilities.memory).toBe(false);
    expect(loadConfig({ PINECONE_API_KEY: "p" }).config.capabilities.memory).toBe(false);
    expect(
      loadConfig({ PINECONE_API_KEY: "p", PINECONE_INDEX: "i", OPENAI_API_KEY: "sk" }).config
        .capabilities.memory
    ).toBe(true);
  });
});

describe("applyRuntimeKeys", () => {
  it("re-resolves the provider chain when a key arrives at runtime", () => {
    const { config, applyRuntimeKeys } = loadConfig();
    expect(config.provider).toBe("none");
    applyRuntimeKeys({ ANTHROPIC_API_KEY: "sk-ant-runtime" });
    expect(config.provider).toBe("anthropic");
  });

  it("re-resolves downward when a key is cleared", () => {
    const { config, applyRuntimeKeys } = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-test" });
    expect(config.provider).toBe("anthropic");
    applyRuntimeKeys({ ANTHROPIC_API_KEY: null });
    expect(config.provider).toBe("none");
  });
});
