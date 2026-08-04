import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import { providerTraits, summaryModel, textOf } from "../models";
import { summarizePagePrompt } from "../prompts/research";
import type { RunContext } from "../agents/runContext";
import { getMemory } from "./memory";
import { runSearch, SEARCH_LABELS, type SearchResult } from "./search";

/**
 * Long pages are condensed before they enter the research context — but only
 * when the search backend returns full text *and* the provider is cheap enough
 * to call once per page. On the Claude Code CLI that would be eight extra
 * process spawns per run, so the excerpt is used instead.
 */
async function condense(result: SearchResult, signal: AbortSignal): Promise<string> {
  const raw = result.raw?.trim();
  const fallback = result.snippet.trim();

  if (!raw || raw.length < 1_200) return fallback || raw || "";
  if (!providerTraits().bulkSummarization) return fallback || raw.slice(0, 1_200);

  try {
    const response = await summaryModel().invoke(
      [new HumanMessage(summarizePagePrompt(raw.slice(0, 40_000)))],
      { signal }
    );
    const summary = textOf(response).trim();
    return summary || fallback;
  } catch (error) {
    logger.warn("Page summarization failed, using excerpt", {
      url: result.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback || raw.slice(0, 1_200);
  }
}

/**
 * Runs one search, registers every result as a numbered source, and returns
 * the digest the model reads. Shared by the agentic tool and the direct
 * research path, so both produce identical citations and trace events.
 */
export async function searchAndRegister(
  ctx: RunContext,
  query: string
): Promise<{ digest: string; found: number }> {
  if (ctx.searchBudgetRemaining === 0) {
    return { digest: "Search budget exhausted.", found: 0 };
  }

  const step = ctx.step("search", query);
  ctx.searchesUsed += 1;

  try {
    const results = await runSearch(query, ctx.signal);

    if (results.length === 0) {
      step.finish("done", "No results");
      ctx.emit({ type: "search", id: step.id, query, resultCount: 0 });
      return {
        digest: `No results for "${query}". Try a different phrasing or a narrower term.`,
        found: 0,
      };
    }

    const condensed = await Promise.all(
      results.map(async (result) => ({ result, summary: await condense(result, ctx.signal) }))
    );

    const lines: string[] = [];
    for (const { result, summary } of condensed) {
      const source = ctx.addSource({
        url: result.url,
        title: result.title,
        snippet: result.snippet || summary,
        query,
      });
      if (!source) continue;

      lines.push(
        [`[${source.n}] ${source.title} — ${source.domain}`, `URL: ${source.url}`, summary].join(
          "\n"
        )
      );
    }

    ctx.emit({ type: "search", id: step.id, query, resultCount: lines.length });
    step.finish("done", `${lines.length} result${lines.length === 1 ? "" : "s"}`);

    return {
      digest: [
        `Results for "${query}" (via ${SEARCH_LABELS[config.searchProvider]}). Cite these by their bracketed number.`,
        "",
        lines.join("\n\n"),
      ].join("\n"),
      found: lines.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    step.finish("failed", message.slice(0, 140));
    ctx.emit({ type: "search", id: step.id, query, resultCount: 0 });
    logger.warn("Search failed", { query, provider: config.searchProvider, error: message });
    return {
      digest: `Search for "${query}" failed: ${message}. Continue with other queries.`,
      found: 0,
    };
  }
}

/**
 * `tool()` carries deeply conditional generics over its zod schema, and
 * instantiating them here sends TypeScript into a recursive expansion
 * (TS2589) severe enough to exhaust the heap on a whole-project `tsc` run.
 *
 * This narrower view keeps the part that matters — the handler's input is
 * still inferred from the schema — while stopping the expansion. These tools
 * are only ever invoked through `StructuredToolInterface` anyway.
 */
type ToolFactory = <Input>(
  handler: (input: Input) => Promise<string>,
  fields: { name: string; description: string; schema: z.ZodType<Input> }
) => StructuredToolInterface;

const defineTool = tool as unknown as ToolFactory;

function buildWebSearchTool(ctx: RunContext): StructuredToolInterface {
  return defineTool(
    async ({ query }: { query: string }) => {
      if (ctx.cancelled) return "Research was cancelled.";
      const { digest } = await searchAndRegister(ctx, query);
      return `${digest}\n\nSearches remaining: ${ctx.searchBudgetRemaining}.`;
    },
    {
      name: "web_search",
      description:
        "Search the live web. Returns numbered, summarized results with URLs. " +
        "Use one focused question per call; prefer several narrow searches over one broad one.",
      schema: z.object({
        query: z.string().min(2).describe("A single, focused search query"),
      }),
    }
  );
}

function buildMemoryTools(ctx: RunContext): StructuredToolInterface[] {
  const memory = getMemory();
  if (!memory) return [];

  const recall = defineTool(
    async ({ query }: { query: string }) => {
      const step = ctx.step("memory", `Recall: ${query}`);
      try {
        const hits = await memory.search(query, 4);
        step.finish("done", `${hits.length} note${hits.length === 1 ? "" : "s"}`);
        if (hits.length === 0) return "No relevant notes in memory.";
        return hits.map((hit, index) => `Note ${index + 1}: ${hit}`).join("\n\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.finish("failed", message.slice(0, 140));
        return `Memory lookup failed: ${message}`;
      }
    },
    {
      name: "recall_memory",
      description:
        "Look up notes saved during earlier research sessions. Use once at the start when the " +
        "topic may have been researched before.",
      schema: z.object({ query: z.string().describe("What to look for in memory") }),
    }
  );

  const remember = defineTool(
    async ({ note }: { note: string }) => {
      const step = ctx.step("memory", "Save note");
      try {
        await memory.save(note, { conversationId: ctx.conversationId });
        step.finish("done");
        return "Saved.";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        step.finish("failed", message.slice(0, 140));
        return `Could not save note: ${message}`;
      }
    },
    {
      name: "save_memory",
      description:
        "Save a durable, self-contained fact worth recalling in a future session. " +
        "Use sparingly — not for restating the answer.",
      schema: z.object({ note: z.string().describe("A single self-contained fact") }),
    }
  );

  return [recall, remember];
}

/**
 * Tools are built per run so they can close over the run's citation table,
 * search budget, and abort signal. There is deliberately no `think_tool`:
 * adaptive thinking already gives the model reflection between tool calls,
 * and the old tool spent a turn writing text nobody read.
 */
export function createResearchTools(ctx: RunContext): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [];
  if (config.capabilities.webSearch) tools.push(buildWebSearchTool(ctx));
  tools.push(...buildMemoryTools(ctx));
  return tools;
}
