"use client";

import React from "react";
import Icon from "./Icon";
import type { Source } from "@/types/chat";

/**
 * Citation numbers are assigned server-side and arrive with the source, so the
 * number shown here is the one the brief cites. The `id` is the anchor a
 * citation marker in the brief scrolls to.
 */
export function sourceAnchorId(turnId: string, n: number): string {
  return `source-${turnId}-${n}`;
}

export default function SourceList({
  sources,
  turnId,
}: {
  sources: Source[];
  turnId: string;
}) {
  if (sources.length === 0) return null;

  return (
    <section aria-label="Sources" className="mt-7">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-mute">
        Sources
        <span className="rounded bg-sunk px-1.5 py-0.5 tabular-nums text-ink-soft">
          {sources.length}
        </span>
      </h3>

      <ol className="grid gap-2 sm:grid-cols-2">
        {sources.map((source) => (
          <li key={source.n} id={sourceAnchorId(turnId, source.n)} className="scroll-mt-24">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-full gap-3 rounded-lg border border-rule bg-surface p-3 transition-colors hover:border-rule-strong hover:bg-raised"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-source-wash font-mono text-[11px] tabular-nums text-source">
                {source.n}
              </span>

              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                  {source.title}
                </span>
                <span className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-mute">
                  <Icon name="link" size={11} />
                  <span className="truncate">{source.domain}</span>
                </span>
                {source.snippet && (
                  <span className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink-mute">
                    {source.snippet}
                  </span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
