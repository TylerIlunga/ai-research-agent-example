/**
 * Effort trades reasoning depth against latency and spend.
 *
 * On Claude it maps straight onto `output_config.effort`. On the OpenAI
 * failover, which has no equivalent parameter, it is approximated with the
 * levers that provider does expose (see `openai.ts`).
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type Role = "planner" | "research" | "synthesis" | "summary";

export interface RoleSpec {
  maxTokens: number;
  effort: Effort;
}

/**
 * One budget per role, shared by both providers so a failover changes which
 * model answers — not how the agent is shaped.
 */
export const ROLES: Record<Role, RoleSpec> = {
  /** Decomposes the question. Short, structured, cheap. */
  planner: { maxTokens: 4_000, effort: "medium" },
  /** Drives the tool loop — this is where research quality lives. */
  research: { maxTokens: 8_192, effort: "high" },
  /** Writes the final brief. Streams, so it gets a generous output budget. */
  synthesis: { maxTokens: 32_000, effort: "high" },
  /** Condenses a single fetched page. Mechanical work, minimal effort. */
  summary: { maxTokens: 3_000, effort: "low" },
};
