/**
 * Mirrors backend/src/types/events.ts. The browser renders these events
 * directly — it never inspects agent framework internals, so a new node on the
 * server does not mean new parsing here.
 */
export const PROTOCOL_VERSION = 1;

export type ResearchPhase = "planning" | "researching" | "writing" | "done";
export type StepKind = "search" | "memory" | "synthesis" | "plan";
export type StepState = "running" | "done" | "failed";

export interface Source {
  n: number;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  query?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  elapsedMs: number;
}

export interface Capabilities {
  reasoning: boolean;
  webSearch: boolean;
  memory: boolean;
}

export type Provider = "anthropic" | "openai" | "claude-code" | "none";
export type SearchProvider = "tavily" | "brave" | "searxng" | "none";
export type ResearchMode = "agentic" | "direct";

/** Credential slots a client may fill at runtime. Values never cross the wire. */
export const RUNTIME_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "TAVILY_API_KEY",
  "BRAVE_API_KEY",
  "SEARXNG_URL",
] as const;

export type RuntimeKey = (typeof RUNTIME_KEYS)[number];

export interface Health {
  status: "healthy" | "degraded";
  provider: Provider;
  model: string;
  /** True when running on a failover provider rather than the preferred one. */
  failover: boolean;
  /** The provider was named explicitly, so earlier options were not tried. */
  providerPinned: boolean;
  searchPinned: boolean;
  searchProvider: SearchProvider;
  searchFailover: boolean;
  researchMode: ResearchMode;
  capabilities: Capabilities;
  claudeCodeAvailable: boolean;
  allowRuntimeKeys: boolean;
  /** Which slots are filled — presence only, never the secret. */
  keys: Record<RuntimeKey, boolean>;
  warnings: string[];
}

export type ResearchEvent =
  | {
      type: "open";
      protocol: number;
      runId: string;
      conversationId: string;
      capabilities: { webSearch: boolean; memory: boolean };
      model: string;
      provider: "anthropic" | "openai" | "claude-code";
      failover: boolean;
      searchProvider: SearchProvider;
      searchFailover: boolean;
      researchMode: ResearchMode;
    }
  | { type: "status"; phase: ResearchPhase; label: string }
  | { type: "plan"; objective: string; questions: string[] }
  | {
      type: "step";
      id: string;
      kind: StepKind;
      label: string;
      state: StepState;
      detail?: string;
    }
  | { type: "search"; id: string; query: string; resultCount: number }
  | { type: "source"; source: Source }
  | { type: "token"; text: string }
  | { type: "report"; markdown: string; sources: Source[] }
  | { type: "usage"; usage: Usage }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; reason: "completed" | "cancelled" | "failed" };

export interface TraceStep {
  id: string;
  kind: StepKind;
  label: string;
  state: StepState;
  detail?: string;
}

export type TurnStatus = "running" | "complete" | "cancelled" | "failed";

export interface Turn {
  id: string;
  question: string;
  askedAt: number;
  /** Answer text, appended token by token while the run is live. */
  answer: string;
  sources: Source[];
  steps: TraceStep[];
  plan: { objective: string; questions: string[] } | null;
  phase: ResearchPhase | null;
  usage: Usage | null;
  error: { code: string; message: string; retryable: boolean } | null;
  status: TurnStatus;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
}
