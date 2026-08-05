import crypto from "crypto";
import { setMaxListeners } from "events";
import { config } from "../config/env";
import type { EventEmit, ResearchEvent, Source, StepKind, StepState } from "../types/events";

/**
 * Everything a single research run needs to talk to the outside world.
 *
 * Tools are constructed per run and close over this object, so citation
 * numbering, the search budget, and cancellation all live in one place instead
 * of being reconstructed from message text after the fact.
 */
export class RunContext {
  readonly runId: string;
  readonly conversationId: string;
  readonly startedAt = Date.now();
  readonly signal: AbortSignal;

  private readonly emitter: EventEmit;
  private readonly byUrl = new Map<string, Source>();

  searchesUsed = 0;
  /** Consecutive provider failures — resets on any successful search. */
  searchErrors = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(options: { conversationId: string; emit: EventEmit; signal: AbortSignal }) {
    this.runId = crypto.randomUUID();
    this.conversationId = options.conversationId;
    this.emitter = options.emit;
    this.signal = options.signal;

    // One signal is handed to every model call, tool call, and fetch in the
    // run. Node warns at ten listeners on the assumption they are a leak;
    // here they are just concurrency, and they are all released together.
    setMaxListeners(64, this.signal);
  }

  get cancelled(): boolean {
    return this.signal.aborted;
  }

  get searchBudgetRemaining(): number {
    return Math.max(0, config.search.budget - this.searchesUsed);
  }

  get sources(): Source[] {
    return [...this.byUrl.values()].sort((a, b) => a.n - b.n);
  }

  emit(event: ResearchEvent): void {
    if (this.cancelled && event.type !== "done") return;
    this.emitter(event);
  }

  status(phase: "planning" | "researching" | "writing" | "done", label: string): void {
    this.emit({ type: "status", phase, label });
  }

  /** Opens a trace row and returns a handle that closes it. */
  step(kind: StepKind, label: string): { id: string; finish: (state: StepState, detail?: string) => void } {
    const id = crypto.randomUUID();
    this.emit({ type: "step", id, kind, label, state: "running" });
    return {
      id,
      finish: (state: StepState, detail?: string) =>
        this.emit({ type: "step", id, kind, label, state, detail }),
    };
  }

  /**
   * Registers a source and assigns its citation number. Deduped on a
   * normalized URL so the same page found by two searches keeps one number.
   */
  addSource(input: { url: string; title: string; snippet: string; query?: string }): Source | null {
    const key = normalizeUrl(input.url);
    if (!key) return null;

    const existing = this.byUrl.get(key);
    if (existing) return existing;

    // Titles and snippets are web-controlled text that ends up in prompts and
    // the UI. Collapsing them to a single line means a crafted page cannot
    // smuggle its own "[9] Fake Source" header into the source digest.
    const title = singleLine(input.title).slice(0, 180);
    const source: Source = {
      n: this.byUrl.size + 1,
      url: input.url,
      title: title || domainOf(input.url) || input.url,
      domain: domainOf(input.url),
      snippet: singleLine(input.snippet).slice(0, 320),
      query: input.query,
    };

    this.byUrl.set(key, source);
    this.emit({ type: "source", source });
    return source;
  }

  /**
   * Providers report usage in different shapes — Anthropic under
   * `response_metadata.usage`, OpenAI under `response_metadata.tokenUsage`.
   * LangChain normalizes both into `usage_metadata`, so prefer that and fall
   * back to the raw shapes when a provider does not populate it.
   */
  recordUsage(message: unknown): void {
    const source = message as {
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
      response_metadata?: {
        usage?: { input_tokens?: number; output_tokens?: number };
        tokenUsage?: { promptTokens?: number; completionTokens?: number };
      };
    };

    const normalized = source.usage_metadata;
    if (normalized) {
      this.inputTokens += normalized.input_tokens ?? 0;
      this.outputTokens += normalized.output_tokens ?? 0;
      return;
    }

    const anthropic = source.response_metadata?.usage;
    if (anthropic) {
      this.inputTokens += anthropic.input_tokens ?? 0;
      this.outputTokens += anthropic.output_tokens ?? 0;
      return;
    }

    const openai = source.response_metadata?.tokenUsage;
    if (openai) {
      this.inputTokens += openai.promptTokens ?? 0;
      this.outputTokens += openai.completionTokens ?? 0;
    }
  }

  usageSnapshot() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      searches: this.searchesUsed,
      elapsedMs: Date.now() - this.startedAt,
    };
  }
}

/** Collapses all whitespace (including newlines) to single spaces. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Strips the noise that makes the same page look like two sources.
 *
 * Only the host is case-folded: URL paths and query values are case-sensitive
 * (YouTube video ids, wiki slugs), and lowercasing them would hand a second
 * page the first page's citation number. `ref` is left alone for the same
 * reason — GitHub and friends use it semantically, unlike `utm_*`.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") {
        url.searchParams.delete(key);
      }
    }
    const path = url.pathname.replace(/\/+$/, "");
    // `host` keeps a non-default port; `hostname` would merge :8080 with :443.
    const host = url.host.replace(/^www\./i, "").toLowerCase();
    return `${host}${path}${url.search}`;
  } catch {
    return null;
  }
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
