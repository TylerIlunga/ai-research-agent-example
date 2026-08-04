"use client";

import React, { useEffect, useRef } from "react";
import Icon from "./Icon";

const MAX_LENGTH = 2000;

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  disabledReason?: string | null;
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  running,
  disabledReason,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a ceiling, then scroll inside the field.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [value]);

  // Esc stops a run from anywhere on the page — except while a dialog is open,
  // where Escape belongs to the dialog. Without this check, dismissing the
  // settings panel mid-run would also silently abort the research.
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[role='dialog']")) return;
      onStop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, onStop]);

  const blocked = Boolean(disabledReason);
  const canSend = value.trim().length > 0 && !running && !blocked;

  return (
    <div className="border-t border-rule bg-surface/85 backdrop-blur-md">
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) onSubmit();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-rule bg-surface p-2 shadow-sm transition-colors focus-within:border-accent">
            <label htmlFor="composer" className="sr-only">
              Research question
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              rows={1}
              value={value}
              maxLength={MAX_LENGTH}
              disabled={blocked}
              placeholder={
                blocked ? disabledReason ?? "Unavailable" : "Ask a research question…"
              }
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                // `isComposing` guards IME input: in Japanese, Chinese or
                // Korean the first Enter commits the candidate word and must
                // not also send the question.
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSend) onSubmit();
                }
              }}
              className="max-h-[200px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-mute focus:outline-none disabled:cursor-not-allowed"
            />

            {running ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-rule-strong px-3 text-[13px] font-medium text-ink transition-colors hover:bg-sunk"
              >
                <Icon name="stop" size={13} />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send question"
              >
                <Icon name="send" size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </form>

        <div className="mt-2 flex items-center justify-between gap-4 px-1 font-mono text-[11px] text-ink-mute">
          <span>
            {running ? (
              <>Esc to stop</>
            ) : (
              <>Enter to send · Shift+Enter for a new line</>
            )}
          </span>
          {value.length > MAX_LENGTH * 0.75 && (
            <span className="tabular-nums">
              {value.length}/{MAX_LENGTH}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
