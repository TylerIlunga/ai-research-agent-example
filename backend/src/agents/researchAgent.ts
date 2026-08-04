import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { plannerModel, providerTraits, researchModel, synthesisModel, textOf } from "../models";
import {
  plannerPrompt,
  researchSystemPrompt,
  synthesisSystemPrompt,
} from "../prompts/research";
import { createResearchTools, searchAndRegister } from "../tools/research";
import { RunContext } from "./runContext";
import type { EventEmit } from "../types/events";
import { PROTOCOL_VERSION } from "../types/events";

/** Hard ceiling on model↔tool round trips, independent of the search budget. */
const MAX_TOOL_ROUNDS = 8;

const ResearchState = Annotation.Root({
  /** Conversation transcript, persisted per thread by the checkpointer. */
  messages: Annotation<BaseMessage[]>({
    reducer: (previous, next) => previous.concat(next),
    default: () => [],
  }),
  question: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  objective: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  questions: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  /** Research-phase notes handed to synthesis; never shown to the user. */
  findings: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
  toolRounds: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  report: Annotation<string>({ reducer: (_, next) => next, default: () => "" }),
});

type State = typeof ResearchState.State;

const checkpointer = new MemorySaver();

class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

function assertLive(ctx: RunContext): void {
  if (ctx.cancelled) throw new Cancelled();
}

/**
 * Appends a synthetic result for every unanswered tool call at the tail of a
 * transcript, mutating the array in place and returning the messages that were
 * added so the caller can persist them.
 *
 * Providers reject an assistant turn whose `tool_use` blocks have no matching
 * `tool_result`. That state is reachable two ways: the tool-round ceiling
 * routes past the tools node, and a cancelled or failed run can be
 * checkpointed between the model committing its calls and the tools node
 * committing their results. Either way the *saved* thread must be left
 * well-formed, or every later question in that conversation fails.
 */
export function closeDanglingToolCalls(transcript: BaseMessage[]): ToolMessage[] {
  const last = transcript.at(-1) as AIMessage | undefined;
  const calls = last?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return [];

  const repairs = calls.map(
    (call) =>
      new ToolMessage({
        tool_call_id: call.id ?? "",
        name: call.name,
        content: "Not executed — the research phase ended before this call ran.",
      })
  );

  transcript.push(...repairs);
  return repairs;
}

/**
 * The planner replies with JSON. Models occasionally wrap it in a fence or add
 * a sentence; pull the first balanced object out rather than trusting the shape.
 */
function extractPlan(text: string): { objective: string; questions: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      objective?: unknown;
      questions?: unknown;
    };
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (questions.length === 0) return null;
    return {
      objective: typeof parsed.objective === "string" ? parsed.objective.trim() : "",
      questions: questions.slice(0, 5).map((question) => question.trim()),
    };
  } catch {
    return null;
  }
}

export function buildResearchGraph(ctx: RunContext, tools: StructuredToolInterface[]) {
  const mode = config.researchMode;
  const toolsByName = new Map(tools.map((item) => [item.name, item]));

  // `bindTools` is optional on the base chat model interface — the Claude Code
  // provider genuinely does not implement it, which is why `direct` mode
  // exists. Only bind when the provider supports it and we intend to use it.
  const base = researchModel();
  const researcher =
    mode === "agentic" && tools.length > 0 && typeof base.bindTools === "function"
      ? base.bindTools(tools)
      : base;

  const plan = async (state: State): Promise<Partial<State>> => {
    assertLive(ctx);
    ctx.status("planning", "Scoping the question");
    const step = ctx.step("plan", "Plan the research");

    // On a follow-up turn the checkpointer has already prepended the earlier
    // exchanges. Without them the planner cannot resolve "it" or "the second
    // option" — it would decompose the follow-up as if it were a fresh topic.
    const priorTurns = state.messages.slice(0, -1);
    const history =
      priorTurns.length > 0
        ? priorTurns
            .slice(-6)
            .map((message) => {
              const speaker = message._getType() === "human" ? "User" : "Assistant";
              return `${speaker}: ${textOf(message).slice(0, 500)}`;
            })
            .filter((line) => line.length > "Assistant: ".length)
            .join("\n\n")
        : undefined;

    try {
      const response = await plannerModel().invoke(
        [
          new HumanMessage(
            plannerPrompt(state.question, config.capabilities.webSearch, history)
          ),
        ],
        { signal: ctx.signal }
      );
      ctx.recordUsage(response);

      const parsed = extractPlan(textOf(response));
      const objective = parsed?.objective || state.question;
      const questions = parsed?.questions ?? [state.question];

      step.finish("done", `${questions.length} sub-question${questions.length === 1 ? "" : "s"}`);
      ctx.emit({ type: "plan", objective, questions });

      return { objective, questions };
    } catch (error) {
      if (ctx.cancelled) throw new Cancelled();
      // A failed plan is recoverable: research the question as asked.
      step.finish("failed", "Falling back to the question as asked");
      logger.warn("Planning failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      ctx.emit({ type: "plan", objective: state.question, questions: [state.question] });
      return { objective: state.question, questions: [state.question] };
    }
  };

  const research = async (state: State): Promise<Partial<State>> => {
    assertLive(ctx);
    if (state.toolRounds === 0) {
      ctx.status("researching", "Gathering sources");
    }

    // A previous run in this conversation may have been cancelled between the
    // model emitting tool calls and the tools node answering them. Close those
    // before sending the transcript, or the provider rejects the whole turn.
    const restored = [...state.messages];
    const restoredRepairs = closeDanglingToolCalls(restored);

    const system = new SystemMessage(
      researchSystemPrompt({
        objective: state.objective,
        questions: state.questions,
        searchBudget: config.search.budget,
        hasWebSearch: config.capabilities.webSearch,
        hasMemory: config.capabilities.memory,
      })
    );

    const response = (await researcher.invoke([system, ...restored], {
      signal: ctx.signal,
    })) as AIMessage;
    ctx.recordUsage(response);

    return {
      messages: [...restoredRepairs, response],
      findings: textOf(response) || state.findings,
    };
  };

  /**
   * Research without a tool loop: search each planned sub-question directly.
   *
   * This is what makes tool-less providers usable — the Claude Code CLI, and
   * most local models, cannot be trusted to emit structured tool calls. It
   * also collapses a run to exactly two model calls (plan, synthesize), which
   * matters when a call costs a process spawn.
   *
   * The trade is that the model cannot follow a thread it did not anticipate
   * at planning time. For most questions the plan already covers the ground.
   */
  const directResearch = async (state: State): Promise<Partial<State>> => {
    assertLive(ctx);
    ctx.status("researching", "Gathering sources");

    if (!config.capabilities.webSearch) {
      return { findings: "No search provider configured; answering from model knowledge." };
    }

    const queries = state.questions.slice(0, config.search.budget);
    const notes: string[] = [];

    for (const query of queries) {
      assertLive(ctx);
      if (ctx.searchBudgetRemaining === 0) break;
      const { digest, found } = await searchAndRegister(ctx, query);
      if (found > 0) notes.push(digest);
    }

    return {
      findings:
        notes.length > 0
          ? notes.join("\n\n")
          : "No sources were found for the planned sub-questions.",
    };
  };

  const runTools = async (state: State): Promise<Partial<State>> => {
    assertLive(ctx);
    const last = state.messages.at(-1) as AIMessage | undefined;
    const calls = last?.tool_calls ?? [];

    // Tools run concurrently; each one already reports its own trace row.
    const results = await Promise.all(
      calls.map(async (call) => {
        const implementation = toolsByName.get(call.name);
        if (!implementation) {
          return new ToolMessage({
            tool_call_id: call.id ?? "",
            name: call.name,
            content: `Unknown tool "${call.name}".`,
          });
        }
        try {
          const output = await implementation.invoke(call.args, { signal: ctx.signal });
          return new ToolMessage({
            tool_call_id: call.id ?? "",
            name: call.name,
            content: typeof output === "string" ? output : JSON.stringify(output),
          });
        } catch (error) {
          if (ctx.cancelled) throw new Cancelled();
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("Tool failed", { tool: call.name, error: message });
          return new ToolMessage({
            tool_call_id: call.id ?? "",
            name: call.name,
            content: `Tool error: ${message}`,
          });
        }
      })
    );

    return { messages: results, toolRounds: state.toolRounds + 1 };
  };

  const synthesize = async (state: State): Promise<Partial<State>> => {
    assertLive(ctx);
    ctx.status("writing", "Writing the brief");
    const step = ctx.step("synthesis", "Synthesize findings");

    const sources = ctx.sources;
    const system = new SystemMessage(synthesisSystemPrompt(sources));

    // If we reached synthesis because the tool-round ceiling was hit, the last
    // message still carries unexecuted tool calls. A transcript whose final
    // assistant turn has a `tool_use` block with no matching result is
    // rejected by the API.
    //
    // Closing them with synthetic results rather than dropping the message
    // matters because the transcript is *checkpointed*: a local edit would
    // leave the dangling call in the saved thread and break every follow-up
    // question in that conversation.
    const transcript = [...state.messages];
    const repairs = closeDanglingToolCalls(transcript);
    const instruction = new HumanMessage(
      [
        `Research request: ${state.question}`,
        "",
        state.findings ? `Research notes:\n${state.findings}` : "",
        "",
        sources.length > 0
          ? "The full text of every source is in the transcript above. Write the brief."
          : "Write the brief.",
      ]
        .filter(Boolean)
        .join("\n")
    );

    let report = "";
    try {
      const stream = await synthesisModel().stream([system, ...transcript, instruction], {
        signal: ctx.signal,
      });

      for await (const chunk of stream) {
        if (ctx.cancelled) break;
        // Usage rides a single chunk near the end of the stream, not every one.
        if (chunk.usage_metadata) ctx.recordUsage(chunk);
        const text = textOf(chunk);
        if (!text) continue;
        report += text;
        ctx.emit({ type: "token", text });
      }
    } catch (error) {
      if (ctx.cancelled) throw new Cancelled();
      step.finish("failed");
      throw error;
    }

    step.finish("done");
    ctx.emit({ type: "report", markdown: report, sources });

    // The repairs go through the channel too, so the checkpoint matches the
    // transcript synthesis actually saw.
    return { report, messages: [...repairs, new AIMessage(report)] };
  };

  const shouldUseTools = (state: State): "tools" | "synthesize" => {
    const last = state.messages.at(-1) as AIMessage | undefined;
    const hasCalls = Array.isArray(last?.tool_calls) && last.tool_calls.length > 0;

    if (!hasCalls) return "synthesize";
    if (state.toolRounds >= MAX_TOOL_ROUNDS) return "synthesize";
    return "tools";
  };

  const graph = new StateGraph(ResearchState)
    .addNode("plan", plan)
    .addNode("research", research)
    .addNode("directResearch", directResearch)
    .addNode("tools", runTools)
    .addNode("synthesize", synthesize)
    .addEdge(START, "plan")
    // The plan is identical in both modes; only how its sub-questions get
    // answered differs.
    .addConditionalEdges("plan", () => mode, {
      agentic: "research",
      direct: "directResearch",
    })
    .addConditionalEdges("research", shouldUseTools, {
      tools: "tools",
      synthesize: "synthesize",
    })
    .addEdge("tools", "research")
    .addEdge("directResearch", "synthesize")
    .addEdge("synthesize", END);

  return graph.compile({ checkpointer });
}

/**
 * Runs one research task, reporting progress through `emit`. Resolves when the
 * stream is finished for any reason — completion, cancellation, or failure.
 */
export async function runResearch(options: {
  question: string;
  conversationId: string;
  emit: EventEmit;
  signal: AbortSignal;
}): Promise<void> {
  const { question, conversationId, emit, signal } = options;
  const ctx = new RunContext({ conversationId, emit, signal });

  emit({
    type: "open",
    protocol: PROTOCOL_VERSION,
    runId: ctx.runId,
    conversationId,
    capabilities: {
      webSearch: config.capabilities.webSearch,
      memory: config.capabilities.memory,
    },
    model: config.activeModel,
    provider: config.provider as "anthropic" | "openai" | "claude-code",
    failover: config.isFailover,
    searchProvider: config.searchProvider,
    searchFailover: config.isSearchFailover,
    researchMode: config.researchMode,
  });

  if (config.provider === "none") {
    emit({
      type: "error",
      code: "missing_credentials",
      message:
        "No model provider is configured on the server. Set ANTHROPIC_API_KEY (preferred) or OPENAI_API_KEY in backend/.env and restart.",
      retryable: false,
    });
    emit({ type: "done", reason: "failed" });
    return;
  }

  const tools = createResearchTools(ctx);
  const graph = buildResearchGraph(ctx, tools);

  try {
    await graph.invoke(
      {
        question,
        toolRounds: 0,
        messages: [new HumanMessage(question)],
      },
      {
        configurable: { thread_id: conversationId },
        recursionLimit: MAX_TOOL_ROUNDS * 2 + 6,
        signal,
      }
    );

    ctx.status("done", "Complete");
    emit({ type: "usage", usage: ctx.usageSnapshot() });
    emit({ type: "done", reason: "completed" });
  } catch (error) {
    if (ctx.cancelled || error instanceof Cancelled) {
      logger.info("Run cancelled", { runId: ctx.runId, conversationId });
      emit({ type: "done", reason: "cancelled" });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error("Run failed", { runId: ctx.runId, conversationId, error: message });

    emit({
      type: "error",
      code: classify(error),
      message: friendly(message, providerTraits().label),
      retryable: isRetryable(error),
    });
    emit({ type: "usage", usage: ctx.usageSnapshot() });
    emit({ type: "done", reason: "failed" });
  }
}

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** A 429 that is really a billing problem — retrying will never help. */
function isBilling(message: string): boolean {
  return /no credits|insufficient_quota|exceeded your current quota|billing/i.test(message);
}

function classify(error: unknown): string {
  if (error instanceof Error && error.name === "MissingCredentials") return "missing_credentials";
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);

  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return isBilling(message) ? "billing" : "rate_limited";
  if (status && status >= 500) return "upstream_unavailable";
  if (isBilling(message)) return "billing";
  return "agent_error";
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (isBilling(message)) return false;
  const status = statusOf(error);
  return status === 429 || (status !== undefined && status >= 500);
}

/**
 * Turn provider errors into something a person can act on. The provider's own
 * wording is often the most useful thing available — a quota 429 says exactly
 * what is wrong — so pass those through rather than flattening every 429 into
 * "try again shortly", which sends the user off to wait for nothing.
 */
function friendly(message: string, provider: string): string {
  const first = message.split("\n")[0].trim();

  if (message.includes("API_KEY")) return message;
  if (isBilling(message)) {
    return `The ${provider} account is out of credit or quota: ${first}`;
  }
  if (/401|invalid.*api.?key/i.test(message)) {
    return `The ${provider} API key was rejected. Check backend/.env.`;
  }
  if (/rate.?limit/i.test(message)) {
    return `${provider} is rate limiting this key. Try again shortly.`;
  }
  return `Research failed: ${first}`;
}
