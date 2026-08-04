import { spawn } from "child_process";
import {
  SimpleChatModel,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { config } from "../config/env";
import { logger } from "../utils/logger";

const SPAWN_TIMEOUT_MS = 300_000;

/**
 * Uses the locally installed Claude Code CLI as a model provider.
 *
 * This is the last-resort failover: it needs no API key, because it borrows
 * whatever credentials `claude` is already logged in with. The trade is real
 * and measured — every invocation re-sends Claude Code's own tool definitions
 * and context (~20-35K tokens) and pays ~4-5s of process startup, so a call
 * costs roughly $0.15 regardless of how short the prompt is.
 *
 * That cost profile is why the agent runs in `direct` research mode on this
 * provider: two calls per run (plan, synthesize) instead of a dozen. See
 * `providerTraits` in ./index.ts.
 */
export class ClaudeCode extends SimpleChatModel {
  private readonly model: string;

  constructor(fields: { model: string } & BaseChatModelParams) {
    super(fields);
    this.model = fields.model;
  }

  _llmType(): string {
    return "claude-code-cli";
  }

  /**
   * The CLI takes one prompt, not a message list. System messages become
   * `--system-prompt` (which replaces Claude Code's own prompt, so it stops
   * behaving like a coding agent); everything else is flattened into a single
   * turn. Our graph only ever sends short transcripts to this provider, so
   * nothing meaningful is lost in the flattening.
   */
  private render(messages: BaseMessage[]): { system: string; prompt: string } {
    const system: string[] = [];
    const turns: string[] = [];

    for (const message of messages) {
      const text = typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
      if (!text.trim()) continue;

      switch (message._getType()) {
        case "system":
          system.push(text);
          break;
        case "ai":
          turns.push(`Assistant:\n${text}`);
          break;
        default:
          turns.push(text);
      }
    }

    return { system: system.join("\n\n"), prompt: turns.join("\n\n") };
  }

  private args(system: string, streaming: boolean): string[] {
    const args = [
      "-p",
      "--model",
      this.model,
      "--output-format",
      streaming ? "stream-json" : "json",
      // No tools: this provider answers, it does not act. The agent's own
      // graph owns searching and citation.
      "--allowed-tools",
      "",
      // Suppress the user's SessionStart hooks — their output would otherwise
      // be injected into the context of every research call.
      "--settings",
      JSON.stringify({ hooks: {} }),
    ];

    if (system) args.push("--system-prompt", system);
    if (streaming) args.push("--include-partial-messages", "--verbose");
    return args;
  }

  /**
   * Prompts go over stdin rather than argv — a synthesis prompt carrying eight
   * summarized sources would otherwise risk the platform's argument limit.
   */
  private run(
    messages: BaseMessage[],
    streaming: boolean,
    signal: AbortSignal | undefined,
    onLine: (line: string) => void
  ): Promise<void> {
    const { system, prompt } = this.render(messages);

    return new Promise((resolve, reject) => {
      const child = spawn(config.claudeCode.bin, this.args(system, streaming), {
        signal,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        // A wedged CLI can ignore SIGTERM; do not leave an orphan holding a
        // pipe open behind us.
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        reject(new Error(`Claude Code CLI timed out after ${SPAWN_TIMEOUT_MS / 1000}s`));
      }, SPAWN_TIMEOUT_MS);

      let stderr = "";
      let buffer = "";

      // A throw inside a stream "data" handler does NOT reject this promise —
      // it surfaces as an uncaughtException, and index.ts responds to those by
      // exiting the process. Every onLine call is therefore fenced, and a
      // callback failure tears down the child and rejects instead.
      const deliver = (line: string): boolean => {
        try {
          onLine(line);
          return true;
        } catch (error) {
          clearTimeout(timer);
          child.kill("SIGTERM");
          reject(error instanceof Error ? error : new Error(String(error)));
          return false;
        }
      };

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          index = buffer.indexOf("\n");
          if (line && !deliver(line)) return;
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? new Error(
                `Claude Code CLI not found at "${config.claudeCode.bin}". Install it or set CLAUDE_CODE_BIN.`
              )
            : error
        );
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (buffer.trim() && !deliver(buffer.trim())) return;
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `Claude Code CLI exited ${code}: ${stderr.trim().slice(0, 400) || "no stderr"}`
          )
        );
      });

      // If the CLI exits before draining stdin — bad binary, auth failure, a
      // prompt larger than the pipe buffer — the pending write emits EPIPE on
      // this stream. Unhandled, Node escalates that to an uncaughtException,
      // which index.ts answers by exiting the process. The real failure is
      // already reported through 'error'/'close', so swallow it here.
      child.stdin.on("error", () => {});
      child.stdin.end(prompt, "utf8");
    });
  }

  async _call(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): Promise<string> {
    let result = "";

    await this.run(messages, false, options.signal, (line) => {
      const parsed = safeParse(line);
      if (!parsed) return;
      if (parsed.type === "result") {
        if (parsed.is_error) {
          throw new Error(String(parsed.result ?? "Claude Code reported an error"));
        }
        result = typeof parsed.result === "string" ? parsed.result : "";
        logCost(parsed);
      }
    });

    return result;
  }

  /**
   * `stream-json` wraps the ordinary Anthropic Messages stream events, so the
   * text deltas can be forwarded straight through.
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const queue: ChatGenerationChunk[] = [];
    let failure: Error | null = null;
    let finished = false;
    let wake: (() => void) | null = null;

    const push = (chunk: ChatGenerationChunk) => {
      queue.push(chunk);
      wake?.();
    };

    const running = this.run(messages, true, options.signal, (line) => {
      const parsed = safeParse(line);
      if (!parsed) return;

      if (parsed.type === "stream_event") {
        const event = parsed.event as
          | { type: string; delta?: { type?: string; text?: string }; usage?: unknown }
          | undefined;
        if (
          event?.type === "content_block_delta" &&
          event.delta?.type === "text_delta" &&
          typeof event.delta.text === "string"
        ) {
          push(
            new ChatGenerationChunk({
              text: event.delta.text,
              message: new AIMessageChunk({ content: event.delta.text }),
            })
          );
        }
        return;
      }

      if (parsed.type === "result") {
        if (parsed.is_error) failure = new Error(String(parsed.result ?? "Claude Code error"));
        logCost(parsed);
        const usage = parsed.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          push(
            new ChatGenerationChunk({
              text: "",
              message: new AIMessageChunk({
                content: "",
                usage_metadata: {
                  input_tokens: usage.input_tokens ?? 0,
                  output_tokens: usage.output_tokens ?? 0,
                  total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
                },
              }),
            })
          );
        }
      }
    })
      .catch((error: Error) => {
        failure = error;
      })
      .finally(() => {
        finished = true;
        wake?.();
      });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      const chunk = queue.shift()!;
      if (chunk.text) await runManager?.handleLLMNewToken(chunk.text);
      yield chunk;
    }

    await running;
    if (failure) throw failure;
  }
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Cost is per-invocation and non-obvious here, so make it visible in the log. */
function logCost(result: Record<string, unknown>): void {
  const cost = result.total_cost_usd;
  if (typeof cost === "number") {
    logger.debug("Claude Code call complete", {
      costUsd: Number(cost.toFixed(4)),
      apiMs: result.duration_api_ms,
    });
  }
}

export function buildClaudeCode(): ClaudeCode {
  return new ClaudeCode({ model: config.claudeCode.model });
}
