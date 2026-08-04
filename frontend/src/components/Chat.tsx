"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import Brief from "./Brief";
import Composer from "./Composer";
import Icon from "./Icon";
import Settings from "./Settings";
import Sidebar from "./Sidebar";
import SourceList from "./SourceList";
import Trace from "./Trace";
import { useConversations } from "@/hooks/useConversations";
import { fetchHealth, streamResearch } from "@/services/api";
import type { Health, ResearchEvent, Turn } from "@/types/chat";

const SUGGESTIONS = [
  "What changed in the EU AI Act's obligations for general-purpose models this year?",
  "Compare Postgres logical replication with Debezium for change data capture.",
  "How are teams handling prompt caching costs on long agent runs?",
  "What is the current evidence on four-day work weeks in software teams?",
];

function emptyTurn(question: string): Turn {
  return {
    id: uuidv4(),
    question,
    askedAt: Date.now(),
    answer: "",
    sources: [],
    steps: [],
    plan: null,
    phase: null,
    usage: null,
    error: null,
    status: "running",
  };
}

/** Folds one protocol event into the turn it belongs to. */
function reduceTurn(turn: Turn, event: ResearchEvent): Turn {
  switch (event.type) {
    case "status":
      return { ...turn, phase: event.phase };

    case "open":
      // Carries the provider/search/mode the run actually used.
      return turn;

    case "plan":
      return { ...turn, plan: { objective: event.objective, questions: event.questions } };

    case "step": {
      const existing = turn.steps.findIndex((step) => step.id === event.id);
      const next = {
        id: event.id,
        kind: event.kind,
        label: event.label,
        state: event.state,
        detail: event.detail,
      };
      if (existing === -1) return { ...turn, steps: [...turn.steps, next] };
      const steps = [...turn.steps];
      steps[existing] = next;
      return { ...turn, steps };
    }

    case "source":
      return turn.sources.some((source) => source.n === event.source.n)
        ? turn
        : { ...turn, sources: [...turn.sources, event.source] };

    case "token":
      return { ...turn, answer: turn.answer + event.text };

    // The report is authoritative — it replaces whatever streamed, which keeps
    // a dropped frame from leaving a hole in the finished brief.
    case "report":
      return { ...turn, answer: event.markdown || turn.answer, sources: event.sources };

    case "usage":
      return { ...turn, usage: event.usage };

    case "error":
      return {
        ...turn,
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };

    case "done":
      return {
        ...turn,
        phase: "done",
        status:
          event.reason === "completed"
            ? "complete"
            : event.reason === "cancelled"
              ? "cancelled"
              : "failed",
      };

    default:
      return turn;
  }
}

export default function Chat() {
  const {
    conversations,
    active,
    activeId,
    setActiveId,
    startNew,
    remove,
    appendTurn,
  } = useConversations();

  const [health, setHealth] = useState<Health | null>(null);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The in-flight turn is held outside the persisted conversation: committing
   * every token to localStorage would write hundreds of times per run.
   */
  const [live, setLive] = useState<{ conversationId: string; turn: Turn } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pendingTokens = useRef<string>("");
  const frame = useRef<number | null>(null);
  /**
   * The authoritative copy of the in-flight turn. State updaters must stay
   * pure — React double-invokes them in development, so folding events inside
   * one would apply every event twice.
   */
  const turnRef = useRef<Turn | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  const turns = useMemo(() => {
    const stored = active?.turns ?? [];
    if (live && live.conversationId === activeId) return [...stored, live.turn];
    return stored;
  }, [active, live, activeId]);

  useEffect(() => {
    // Only follow the stream when the reader is already at the bottom —
    // otherwise scrolling up to re-read a source fights the auto-scroll.
    const main = bottomRef.current?.closest("main");
    if (main) {
      const distance = main.scrollHeight - main.scrollTop - main.clientHeight;
      if (distance > 160) return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, live?.turn.steps.length, live?.turn.status]);

  const running = live?.turn.status === "running";

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (question: string) => {
      const conversationId = activeId ?? startNew();
      turnRef.current = emptyTurn(question);
      setLive({ conversationId, turn: turnRef.current });

      const controller = new AbortController();
      abortRef.current = controller;

      const publish = () => {
        if (turnRef.current) setLive({ conversationId, turn: turnRef.current });
      };

      // Tokens arrive faster than the screen refreshes; batch them per frame
      // so a long brief does not thrash React.
      const flush = () => {
        frame.current = null;
        const text = pendingTokens.current;
        if (!text || !turnRef.current) return;
        pendingTokens.current = "";
        turnRef.current = { ...turnRef.current, answer: turnRef.current.answer + text };
        publish();
      };

      const apply = (event: ResearchEvent) => {
        if (!turnRef.current) return;
        if (event.type === "open") {
          // The server may have switched provider since the page loaded (a key
          // was added, a quota ran out). Reconcile the badges with the run.
          setHealth((current) =>
            current
              ? {
                  ...current,
                  provider: event.provider,
                  model: event.model,
                  failover: event.failover,
                  searchProvider: event.searchProvider,
                  searchFailover: event.searchFailover,
                  researchMode: event.researchMode,
                }
              : current
          );
        }
        if (event.type === "token") {
          pendingTokens.current += event.text;
          frame.current ??= requestAnimationFrame(flush);
          return;
        }
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          flush();
        }
        turnRef.current = reduceTurn(turnRef.current, event);
        publish();
      };

      let failure: string | null = null;

      try {
        await streamResearch({
          query: question,
          conversationId,
          signal: controller.signal,
          onEvent: apply,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          failure =
            error instanceof Error ? error.message : "Could not reach the research service.";
        }
      } finally {
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }

        const trailing = pendingTokens.current;
        pendingTokens.current = "";
        abortRef.current = null;

        if (turnRef.current) {
          let finished: Turn = {
            ...turnRef.current,
            answer: turnRef.current.answer + trailing,
          };

          if (failure) {
            finished = {
              ...finished,
              status: "failed",
              error: { code: "transport", message: failure, retryable: true },
            };
          } else if (finished.status === "running") {
            // Check the reducer's terminal status first: a `done` frame that
            // landed just before Stop was pressed must not be relabelled.
            finished = {
              ...finished,
              status: controller.signal.aborted ? "cancelled" : "complete",
            };
          }

          turnRef.current = null;
          // Commit to history, then drop the live copy — in that order, so the
          // turn never disappears from the screen for a frame.
          appendTurn(conversationId, finished);
          setLive(null);
        }
      }
    },
    [activeId, appendTurn, startNew]
  );

  const submit = useCallback(() => {
    const question = input.trim();
    if (!question || running) return;
    setInput("");
    void run(question);
  }, [input, running, run]);

  const blocked =
    health && !health.capabilities.reasoning
      ? "Set ANTHROPIC_API_KEY or OPENAI_API_KEY on the server to start researching"
      : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-ground text-ink">
      {/* Sidebar: fixed on desktop, a drawer below it. */}
      <aside className="hidden w-[270px] shrink-0 lg:block">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          health={health}
          onSelect={setActiveId}
          onNew={() => {
            stop();
            startNew();
          }}
          onDelete={remove}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[270px] max-w-[80vw]">
            <Sidebar
              conversations={conversations}
              activeId={activeId}
              health={health}
              onSelect={(id) => {
                setActiveId(id);
                setSidebarOpen(false);
              }}
              onNew={() => {
                stop();
                startNew();
                setSidebarOpen(false);
              }}
              onDelete={remove}
              onClose={() => setSidebarOpen(false)}
              onOpenSettings={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-rule bg-surface px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded p-1 text-ink-mute transition-colors hover:text-ink lg:hidden"
            aria-label="Open sidebar"
          >
            <Icon name="panel" size={16} />
          </button>

          <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            {active?.turns.length ? active.title : "New research"}
          </h1>

          {/* Degraded modes are stated in the chrome, not discovered mid-run. */}
          {health?.failover && (
            <span
              className="flex items-center gap-1.5 rounded-md bg-caution-wash px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-caution"
              title={`No Anthropic key on the server — running on ${health.model}`}
            >
              <Icon name="alert" size={11} />
              Failover · {health.model}
            </span>
          )}

          {health?.searchFailover && (
            <span
              className="flex items-center gap-1.5 rounded-md bg-caution-wash px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-caution"
              title="No Tavily key — searching with the failover backend"
            >
              <Icon name="search" size={11} />
              {health.searchProvider}
            </span>
          )}

          {health && !health.capabilities.webSearch && (
            <span className="flex items-center gap-1.5 rounded-md bg-caution-wash px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-caution">
              <Icon name="alert" size={11} />
              No live search
            </span>
          )}

          {health && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mute transition-colors hover:text-ink"
              title="Providers and keys"
            >
              keys
            </button>
          )}
        </header>

        <main className="scroll-area min-h-0 flex-1 overflow-y-auto">
          {turns.length === 0 ? (
            <EmptyState
              onPick={(question) => {
                setInput(question);
                document.getElementById("composer")?.focus();
              }}
              notice={
                blocked
                  ? {
                      tone: "blocked",
                      headline: blocked,
                      onOpenSettings: () => setSettingsOpen(true),
                    }
                  : health?.failover
                    ? {
                        tone: "failover",
                        headline: `Running on the ${health.model} failover — no Anthropic key is set on the server`,
                        onOpenSettings: () => setSettingsOpen(true),
                      }
                    : null
              }
              warnings={health?.warnings ?? []}
            />
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
              <div className="flex flex-col gap-12">
                {turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    onRetry={() => void run(turn.question)}
                    canRetry={!running}
                  />
                ))}
              </div>
              <div ref={bottomRef} className="h-4" />
            </div>
          )}
        </main>

        {settingsOpen && health && (
          <Settings
            health={health}
            onClose={() => setSettingsOpen(false)}
            onSaved={setHealth}
          />
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stop}
          running={Boolean(running)}
          disabledReason={blocked}
        />
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  notice,
  warnings,
}: {
  onPick: (question: string) => void;
  notice: {
    tone: "blocked" | "failover";
    headline: string;
    onOpenSettings?: () => void;
  } | null;
  warnings: string[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col justify-center px-4 py-16 sm:px-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-mute">
        Multi-step research with citations
      </p>
      <h2 className="mt-3 max-w-xl text-2xl leading-tight tracking-tight text-ink sm:text-3xl">
        Ask something that needs looking up.
      </h2>
      <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
        The agent breaks your question into sub-questions, searches for each, and writes a
        brief with every claim traced back to a source. You can watch it work and stop it at
        any point.
      </p>

      {notice && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-rule bg-caution-wash p-4">
          <span className="mt-0.5 shrink-0 text-caution">
            <Icon name="alert" size={16} />
          </span>
          <div className="min-w-0 text-[13px] leading-relaxed text-ink">
            <p className="font-medium">{notice.headline}</p>
            {notice.tone === "failover" && (
              <p className="mt-1 text-ink-soft">
                Research still works. Add an Anthropic key for planning and synthesis on Claude
                Opus 5.
              </p>
            )}
            {notice.onOpenSettings && (
              <button
                type="button"
                onClick={notice.onOpenSettings}
                className="mt-2 rounded-md border border-rule-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                Providers &amp; keys
              </button>
            )}
            {warnings.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-ink-soft">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <ul className="mt-8 flex flex-col gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => onPick(suggestion)}
              className="group flex w-full items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-3 text-left text-[14px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
            >
              <span className="text-ink-mute transition-colors group-hover:text-accent">
                <Icon name="search" size={14} />
              </span>
              <span className="min-w-0 flex-1">{suggestion}</span>
              <span className="shrink-0 text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
                <Icon name="chevron" size={13} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TurnView({
  turn,
  onRetry,
  canRetry,
}: {
  turn: Turn;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const streaming = turn.status === "running" && turn.answer.length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied or unavailable outside a secure
      // context; the export button still works, so fail quietly.
    }
  };

  const exportMarkdown = () => {
    const body = [
      `# ${turn.question}`,
      "",
      turn.answer,
      "",
      turn.sources.length > 0 ? "## Sources" : "",
      ...turn.sources.map((source) => `${source.n}. [${source.title}](${source.url})`),
    ].join("\n");

    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `research-${turn.id.slice(0, 8)}.md`;
    link.click();
    // Revoking in the same tick can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <article className="flex flex-col gap-5">
      <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">
        {turn.question}
      </h2>

      <Trace turn={turn} />

      {turn.error && (
        <div className="flex items-start gap-3 rounded-lg border border-rule bg-danger-wash p-4">
          <span className="mt-0.5 shrink-0 text-danger">
            <Icon name="alert" size={16} />
          </span>
          <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
            {turn.error.message}
          </div>
          {turn.error.retryable && canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-rule-strong bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-sunk"
            >
              <Icon name="retry" size={12} />
              Retry
            </button>
          )}
        </div>
      )}

      {turn.answer && (
        <div aria-busy={turn.status === "running"}>
          <Brief
            markdown={turn.answer}
            sources={turn.sources}
            turnId={turn.id}
            streaming={streaming}
          />
        </div>
      )}

      {turn.status === "cancelled" && (
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-mute">
          Stopped — the partial brief above is what had been written
        </p>
      )}

      <SourceList sources={turn.sources} turnId={turn.id} />

      {turn.status !== "running" && turn.answer && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3 font-mono text-[11px] text-ink-mute">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 transition-colors hover:text-ink"
          >
            <Icon name={copied ? "check" : "copy"} size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className="flex items-center gap-1.5 transition-colors hover:text-ink"
          >
            <Icon name="download" size={12} />
            Markdown
          </button>
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 transition-colors hover:text-ink"
            >
              <Icon name="retry" size={12} />
              Run again
            </button>
          )}
          {turn.usage && (
            <span className="ml-auto tabular-nums">
              {turn.usage.searches} search{turn.usage.searches === 1 ? "" : "es"} ·{" "}
              {(turn.usage.inputTokens + turn.usage.outputTokens).toLocaleString()} tokens ·{" "}
              {(turn.usage.elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
        </footer>
      )}
    </article>
  );
}
