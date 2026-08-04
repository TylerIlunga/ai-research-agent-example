"use client";

import React, { useState } from "react";
import Icon, { type IconName } from "./Icon";
import type { StepKind, StepState, Turn } from "@/types/chat";

const KIND_ICON: Record<StepKind, IconName> = {
  plan: "plan",
  search: "search",
  memory: "memory",
  synthesis: "write",
};

function stateClasses(state: StepState): { dot: string; text: string } {
  switch (state) {
    case "done":
      return { dot: "border-source text-source bg-source-wash", text: "text-ink-soft" };
    case "failed":
      return { dot: "border-danger text-danger bg-danger-wash", text: "text-danger" };
    default:
      return { dot: "border-accent text-accent bg-accent-wash", text: "text-ink" };
  }
}

function StepRow({ step }: { step: Turn["steps"][number] }) {
  const classes = stateClasses(step.state);

  return (
    <li className="flex items-start gap-3 rise">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${classes.dot}`}
      >
        {step.state === "done" ? (
          <Icon name="check" size={13} strokeWidth={2.2} />
        ) : step.state === "failed" ? (
          <Icon name="alert" size={12} />
        ) : (
          <Icon name={KIND_ICON[step.kind]} size={12} />
        )}
      </span>

      <span className="min-w-0 flex-1 pt-0.5">
        <span
          className={`block truncate text-[13px] ${classes.text} ${
            step.kind === "search" ? "font-mono" : ""
          }`}
          title={step.label}
        >
          {step.label}
        </span>
        {step.detail && (
          <span className="block truncate text-[11px] text-ink-mute">{step.detail}</span>
        )}
      </span>

      {/* State is carried in text as well as colour, for anyone who cannot use hue. */}
      <span className="shrink-0 pt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mute">
        {step.state === "running" ? "running" : step.state === "failed" ? "failed" : "done"}
      </span>
    </li>
  );
}

/**
 * The live research trace: the plan, then one row per action the agent takes,
 * with the literal search queries it issued. Collapses to a one-line summary
 * once the run is finished so completed turns stay readable.
 */
export default function Trace({ turn }: { turn: Turn }) {
  const live = turn.status === "running";
  // Collapse once the run ends: the trace is a progress view, and a finished
  // one competes with the answer for attention. Reopening is one click.
  const [open, setOpen] = useState(false);
  const expanded = live || open;

  if (turn.steps.length === 0 && !turn.plan) {
    return (
      <div className="flex items-center gap-2.5 text-[13px] text-ink-mute">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Connecting to the agent…
      </div>
    );
  }

  const searches = turn.steps.filter((step) => step.kind === "search").length;
  const summary = [
    turn.plan ? `${turn.plan.questions.length} sub-questions` : null,
    searches > 0 ? `${searches} search${searches === 1 ? "" : "es"}` : null,
    turn.sources.length > 0 ? `${turn.sources.length} sources` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className="rounded-lg border border-rule bg-surface"
      aria-label="Research trace"
    >
      <header className="flex items-center gap-3 px-4 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
          {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {live ? turn.phase ?? "working" : "trace"}
        </span>

        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-mute">{summary}</span>

        {!live && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-mute transition-colors hover:text-ink"
            aria-expanded={expanded}
          >
            {expanded ? "Hide" : "Show"}
            <Icon
              name="chevron"
              size={12}
              className={expanded ? "rotate-90 transition-transform" : "transition-transform"}
            />
          </button>
        )}
      </header>

      {expanded && (
        <div className="border-t border-rule px-4 py-3.5">
          {turn.plan && (
            <div className="mb-4">
              <p className="mb-2 text-[13px] leading-snug text-ink-soft">{turn.plan.objective}</p>
              <ol className="flex flex-col gap-1">
                {turn.plan.questions.map((question, index) => (
                  <li key={question} className="flex gap-2.5 text-[12px] text-ink-mute">
                    <span className="font-mono tabular-nums">{index + 1}.</span>
                    <span className="min-w-0 flex-1">{question}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <ul className="flex flex-col gap-2.5">
            {turn.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
