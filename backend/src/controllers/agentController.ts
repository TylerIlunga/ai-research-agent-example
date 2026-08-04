import crypto from "crypto";
import type { Request, Response } from "express";
import { runResearch } from "../agents/researchAgent";
import { config } from "../config/env";
import { logger } from "../utils/logger";
import type { ResearchEvent, Source } from "../types/events";

const MAX_QUERY_LENGTH = 2_000;
const HEARTBEAT_MS = 15_000;

interface ParsedRequest {
  query: string;
  conversationId: string;
}

function parse(req: Request): ParsedRequest | { error: string } {
  const source = req.method === "GET" ? req.query : req.body;
  const query = typeof source?.query === "string" ? source.query.trim() : "";
  const conversationId =
    typeof source?.conversationId === "string" && source.conversationId.trim()
      ? source.conversationId.trim().slice(0, 100)
      : crypto.randomUUID();

  if (!query) return { error: "A research question is required." };
  if (query.length > MAX_QUERY_LENGTH) {
    return { error: `Questions are limited to ${MAX_QUERY_LENGTH} characters.` };
  }
  return { query, conversationId };
}

/**
 * Server-sent events, done properly:
 *
 * - headers flushed immediately so the browser sees the stream open;
 * - a comment heartbeat every 15s so proxies and load balancers do not reap an
 *   idle connection during a long search;
 * - `X-Accel-Buffering: no` for nginx-style proxies;
 * - client disconnect aborts the run instead of letting it keep spending on
 *   model and search calls nobody will read.
 *
 * Note that `compression()` is configured in index.ts to skip this content
 * type — with gzip in the path, events sit in the compressor's buffer and the
 * stream stops being real-time.
 */
export const streamResponse = async (req: Request, res: Response): Promise<void> => {
  const parsed = parse(req);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error, code: "INVALID_QUERY" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const controller = new AbortController();
  let closed = false;

  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    res.end();
  };

  // Listen on the *response*, not the request. `req`'s "close" fires when the
  // request stream ends — which for a POST is the moment the body has been
  // read, a few milliseconds in — and would abort every run immediately.
  // `res`'s "close" is the one that means the client actually went away.
  res.on("close", () => {
    if (closed) return;
    logger.info("Client disconnected, aborting run", {
      conversationId: parsed.conversationId,
    });
    controller.abort();
    closed = true;
    clearInterval(heartbeat);
  });

  const emit = (event: ResearchEvent) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const startedAt = Date.now();
  logger.info("Research started", {
    conversationId: parsed.conversationId,
    length: parsed.query.length,
  });

  try {
    await runResearch({
      question: parsed.query,
      conversationId: parsed.conversationId,
      emit,
      signal: controller.signal,
    });
  } catch (error) {
    // runResearch handles its own failures; this is the last line of defence.
    logger.error("Unhandled streaming failure", {
      error: error instanceof Error ? error.message : String(error),
    });
    emit({
      type: "error",
      code: "internal_error",
      message: "The research run failed unexpectedly.",
      retryable: true,
    });
    emit({ type: "done", reason: "failed" });
  } finally {
    logger.info("Research finished", {
      conversationId: parsed.conversationId,
      ms: Date.now() - startedAt,
    });
    finish();
  }
};

/**
 * Non-streaming variant for scripts and integrations. Runs the same graph and
 * folds the event stream into a single JSON response.
 */
export const processQuery = async (req: Request, res: Response): Promise<void> => {
  const parsed = parse(req);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error, code: "INVALID_QUERY" });
    return;
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  let markdown = "";
  let streamed = "";
  let sources: Source[] = [];
  let failure: { code: string; message: string } | null = null;

  await runResearch({
    question: parsed.query,
    conversationId: parsed.conversationId,
    signal: controller.signal,
    emit: (event) => {
      if (event.type === "report") {
        markdown = event.markdown;
        sources = event.sources;
      } else if (event.type === "token") {
        // Accumulated separately: the report is authoritative when it arrives,
        // and the token stream is the fallback when it does not.
        streamed += event.text;
      } else if (event.type === "error") {
        failure = { code: event.code, message: event.message };
      }
    },
  });

  if (failure) {
    const { code, message } = failure as { code: string; message: string };
    res.status(code === "missing_credentials" ? 503 : 500).json({ error: message, code });
    return;
  }

  res.json({
    response: markdown || streamed,
    conversationId: parsed.conversationId,
    sources,
    model: config.activeModel,
  });
};
