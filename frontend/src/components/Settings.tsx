"use client";

import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { saveKeys } from "@/services/api";
import {
  type Health,
  type Provider,
  type RuntimeKey,
  type SearchProvider,
} from "@/types/chat";

interface Slot {
  key: RuntimeKey;
  label: string;
  hint: string;
  placeholder: string;
}

const MODEL_SLOTS: Slot[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    hint: "Preferred. Runs planning and synthesis on Claude.",
    placeholder: "sk-ant-…",
  },
  {
    key: "OPENAI_API_KEY",
    label: "OpenAI",
    hint: "First failover. Also powers embeddings for long-term memory.",
    placeholder: "sk-…",
  },
  {
    key: "OPENAI_BASE_URL",
    label: "OpenAI-compatible URL",
    hint: "Point the failover at a local model — Ollama, LM Studio, vLLM.",
    placeholder: "http://localhost:11434/v1",
  },
];

const SEARCH_SLOTS: Slot[] = [
  {
    key: "TAVILY_API_KEY",
    label: "Tavily",
    hint: "Preferred. The only backend that returns full page text to summarize.",
    placeholder: "tvly-…",
  },
  {
    key: "BRAVE_API_KEY",
    label: "Brave Search",
    hint: "Failover. Independent index, 2,000 free queries a month.",
    placeholder: "BSA…",
  },
  {
    key: "SEARXNG_URL",
    label: "SearXNG URL",
    hint: "Keyless failover. Point at an instance you run; needs JSON enabled.",
    placeholder: "http://localhost:8080",
  },
];

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "claude-code": "Claude Code CLI",
  none: "none",
};

/**
 * The Anthropic slot is a tier, not a fixed model — `ANTHROPIC_MODEL` selects
 * between Opus 5 and Sonnet 5. Name whichever one the server actually
 * loaded rather than a constant that goes stale the first time it is changed.
 */
function anthropicLabel(health: Health): string {
  return health.provider === "anthropic" ? health.model : "Anthropic";
}

const SEARCH_LABEL: Record<SearchProvider, string> = {
  tavily: "Tavily",
  brave: "Brave Search",
  searxng: "SearXNG",
  none: "none",
};

function Chain({
  steps,
  activeIndex,
  pinned,
}: {
  steps: { name: string; note: string }[];
  activeIndex: number;
  /** When the provider was named explicitly, earlier options were never tried. */
  pinned: boolean;
}) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, index) => {
        const active = index === activeIndex;
        const skipped = !pinned && activeIndex >= 0 && index < activeIndex;
        return (
          <li key={step.name} className="flex items-start gap-2.5 text-[12px]">
            <span
              className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
                active ? "bg-source" : skipped ? "bg-caution" : "bg-rule-strong"
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className={active ? "font-medium text-ink" : "text-ink-soft"}>
                {step.name}
              </span>
              {active && (
                <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-source">
                  {pinned ? "pinned" : "in use"}
                </span>
              )}
              {skipped && (
                <span className="ml-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-caution">
                  unavailable
                </span>
              )}
              <span className="block text-ink-mute">{step.note}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SlotFields({
  slots,
  health,
  values,
  onChange,
}: {
  slots: Slot[];
  health: Health;
  values: Partial<Record<RuntimeKey, string>>;
  onChange: (key: RuntimeKey, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {slots.map((slot) => {
        const filled = health.keys?.[slot.key];
        return (
          <label key={slot.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
              {slot.label}
              {filled && (
                <span className="flex items-center gap-1 rounded bg-source-wash px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-source">
                  <Icon name="check" size={9} strokeWidth={2.5} />
                  set
                </span>
              )}
            </span>
            <input
              type={slot.key.endsWith("_URL") ? "url" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={values[slot.key] ?? ""}
              placeholder={filled ? "•••••••••  (replace)" : slot.placeholder}
              onChange={(event) => onChange(slot.key, event.target.value)}
              className="w-full rounded-md border border-rule bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-mute focus:border-accent focus:outline-none"
            />
            <span className="text-[11px] leading-snug text-ink-mute">{slot.hint}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Explains the failover chains and lets keys be supplied without editing
 * `.env`. Keys are sent to the server and held in memory there for its
 * lifetime — never written to disk, never read back.
 */
export default function Settings({
  health,
  onClose,
  onSaved,
}: {
  health: Health;
  onClose: () => void;
  onSaved: (health: Health) => void;
}) {
  const [values, setValues] = useState<Partial<Record<RuntimeKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null);

    // A dialog that announces aria-modal has to behave like one: Tab must not
    // walk out into the page behind it, and focus returns where it came from.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    panel?.querySelector("input")?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const modelIndex = ["anthropic", "openai", "claude-code"].indexOf(health.provider);
  const searchIndex = ["tavily", "brave", "searxng"].indexOf(health.searchProvider);
  const dirty = Object.values(values).some((value) => (value ?? "").trim().length > 0);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<Record<RuntimeKey, string>> = {};
      for (const [key, value] of Object.entries(values)) {
        if ((value ?? "").trim()) payload[key as RuntimeKey] = value!.trim();
      }
      const next = await saveKeys(payload);
      onSaved(next);
      setValues({});
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save the keys.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <button
        type="button"
        className="fixed inset-0 bg-black/45"
        aria-label="Close settings"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Providers and keys"
        className="relative w-full max-w-2xl rounded-xl border border-rule bg-surface shadow-lg"
      >
        <header className="flex items-center gap-3 border-b border-rule px-5 py-3.5">
          <h2 className="flex-1 text-[14px] font-semibold text-ink">Providers &amp; keys</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-mute transition-colors hover:text-ink"
            aria-label="Close"
          >
            <Icon name="plus" size={16} className="rotate-45" />
          </button>
        </header>

        <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto px-5 py-5 scroll-area">
          <section>
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
              How failover works
            </h3>
            <p className="mb-4 max-w-prose text-[13px] leading-relaxed text-ink-soft">
              Two independent chains. Each one takes the first option it can actually use, so a
              missing key costs quality rather than availability — and the app tells you which
              option answered instead of leaving you to infer it.
            </p>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
                  Model · now{" "}
                  {health.provider === "anthropic"
                    ? health.model
                    : PROVIDER_LABEL[health.provider]}
                </p>
                <Chain
                  pinned={health.providerPinned}
                  activeIndex={modelIndex}
                  steps={[
                    {
                      name: anthropicLabel(health),
                      note: "Anthropic key. What the prompts are written for.",
                    },
                    { name: "OpenAI", note: "Any OpenAI-compatible endpoint, including local models." },
                    {
                      name: "Claude Code CLI",
                      note: health.claudeCodeAvailable
                        ? "No key needed — uses your local login. ~$0.15 and ~5s per call."
                        : "Not installed on this machine.",
                    },
                  ]}
                />
              </div>

              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
                  Search · now {SEARCH_LABEL[health.searchProvider]}
                </p>
                <Chain
                  pinned={health.searchPinned}
                  activeIndex={searchIndex}
                  steps={[
                    { name: "Tavily", note: "Returns full page text, so sources get summarized." },
                    { name: "Brave Search", note: "Independent index. 2,000 free queries a month." },
                    { name: "SearXNG", note: "Keyless. Self-hosted metasearch; snippets only." },
                  ]}
                />
              </div>
            </div>

            <p className="mt-4 rounded-md border border-rule bg-sunk px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">
                Research mode: {health.researchMode}.
              </span>{" "}
              {health.researchMode === "direct"
                ? "The current model has no tool calling, so each planned sub-question is searched directly. That keeps the run to two model calls and works with local models."
                : "The model drives its own search loop, following threads it did not anticipate when planning."}
            </p>
          </section>

          <form onSubmit={submit} className="flex flex-col gap-5">
            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Model keys
              </h3>
              <SlotFields
                slots={MODEL_SLOTS}
                health={health}
                values={values}
                onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
              />
            </section>

            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                Search keys
              </h3>
              <SlotFields
                slots={SEARCH_SLOTS}
                health={health}
                values={values}
                onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
              />
            </section>

            {!health.allowRuntimeKeys && (
              <p className="rounded-md border border-rule bg-caution-wash px-3 py-2 text-[12px] leading-relaxed text-ink">
                This server does not accept keys over the API. Set them in the environment
                instead.
              </p>
            )}

            {error && (
              <p className="rounded-md border border-rule bg-danger-wash px-3 py-2 text-[12px] text-ink">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!dirty || saving || !health.allowRuntimeKeys}
                className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save keys"}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-[12px] text-source">
                  <Icon name="check" size={13} strokeWidth={2.4} />
                  Applied
                </span>
              )}
              <span className="ml-auto text-right text-[11px] leading-snug text-ink-mute">
                Held in memory on the server only.
                <br />
                Never written to disk; cleared on restart.
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
