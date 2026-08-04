/**
 * The wire contract between the agent and any client.
 *
 * This is the single source of truth for what a research run can say. The
 * browser renders these events directly — it never inspects LangGraph
 * internals, so adding a node does not mean teaching the client a new shape.
 *
 * Bump PROTOCOL_VERSION on any breaking change; clients check it on `open`.
 */
export const PROTOCOL_VERSION = 1;

export type ResearchPhase = "planning" | "researching" | "writing" | "done";

export type StepKind = "search" | "memory" | "synthesis" | "plan";

export type StepState = "running" | "done" | "failed";

export interface Source {
  /** Citation number, assigned once server-side and never recomputed. */
  n: number;
  url: string;
  title: string;
  domain: string;
  snippet: string;
  /** Which sub-question this source was gathered for, when known. */
  query?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  elapsedMs: number;
}

export type ResearchEvent =
  /** Always the first event. Tells the client what the server can do. */
  | {
      type: "open";
      protocol: number;
      runId: string;
      conversationId: string;
      capabilities: { webSearch: boolean; memory: boolean };
      model: string;
      provider: "anthropic" | "openai" | "claude-code";
      /** True when running on a failover provider rather than the preferred one. */
      failover: boolean;
      searchProvider: "tavily" | "brave" | "searxng" | "none";
      searchFailover: boolean;
      /** `direct` means sub-questions were searched without a model tool loop. */
      researchMode: "agentic" | "direct";
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
  /** Answer text. Only ever emitted by the synthesis node. */
  | { type: "token"; text: string }
  /** Authoritative final answer; the client reconciles streamed text against it. */
  | { type: "report"; markdown: string; sources: Source[] }
  | { type: "usage"; usage: Usage }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; reason: "completed" | "cancelled" | "failed" };

export type EventEmit = (event: ResearchEvent) => void;
