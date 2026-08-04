"use client";

import React from "react";
import Icon from "./Icon";
import { useTheme } from "@/hooks/useTheme";
import type { Conversation, Health } from "@/types/chat";

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  health: Health | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  conversations,
  activeId,
  health,
  onSelect,
  onNew,
  onDelete,
  onClose,
  onOpenSettings,
}: SidebarProps) {
  const { choice, cycle } = useTheme();

  return (
    <div className="flex h-full w-full flex-col border-r border-rule bg-sunk">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-ink">
          <Icon name="search" size={14} strokeWidth={2} />
        </span>
        <span className="flex-1 text-[13px] font-semibold tracking-tight text-ink">
          Research Agent
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-mute transition-colors hover:text-ink lg:hidden"
          aria-label="Close sidebar"
        >
          <Icon name="panel" size={15} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-rule bg-surface px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:border-rule-strong"
        >
          <Icon name="plus" size={14} />
          New research
        </button>
      </div>

      <nav aria-label="Previous research" className="scroll-area min-h-0 flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5 pb-3">
          {conversations.map((conversation) => {
            const isActive = conversation.id === activeId;
            return (
              <li key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`w-full rounded-lg px-3 py-2 pr-8 text-left transition-colors ${
                    isActive ? "bg-surface text-ink" : "text-ink-soft hover:bg-surface/60"
                  }`}
                >
                  <span className="block truncate text-[13px] leading-snug">
                    {conversation.title}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-ink-mute">
                    {conversation.turns.length > 0
                      ? `${conversation.turns.length} turn${conversation.turns.length === 1 ? "" : "s"} · ${relativeTime(conversation.updatedAt)}`
                      : "empty"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(conversation.id)}
                  className="pointer-events-none absolute right-1.5 top-2.5 rounded p-1 text-ink-mute opacity-0 transition-opacity hover:text-danger focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                  aria-label={`Delete ${conversation.title}`}
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-rule px-4 py-3">
        {/* The capability line reports what the server can actually do, rather
            than advertising features that are switched off. */}
        <ul className="mb-3 flex flex-col gap-1 font-mono text-[10px] text-ink-mute">
          {health ? (
            <>
              <CapabilityRow
                label="model"
                value={health.model}
                ok={health.capabilities.reasoning && !health.failover}
              />
              <CapabilityRow
                label="search"
                value={health.searchProvider}
                ok={health.capabilities.webSearch && !health.searchFailover}
              />
              <CapabilityRow
                label="mode"
                value={health.researchMode}
                ok={health.researchMode === "agentic"}
              />
              <CapabilityRow
                label="memory"
                value={health.capabilities.memory ? "on" : "off"}
                ok={health.capabilities.memory}
              />
            </>
          ) : (
            <li className="text-caution">server unreachable</li>
          )}
        </ul>

        <button
          type="button"
          onClick={onOpenSettings}
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-surface"
        >
          <Icon name="plan" size={14} />
          <span className="flex-1 text-left">Providers &amp; keys</span>
        </button>

        <button
          type="button"
          onClick={cycle}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-surface"
        >
          <Icon name={choice === "dark" ? "moon" : "sun"} size={14} />
          <span className="flex-1 text-left">Theme</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-mute">
            {choice}
          </span>
        </button>
      </div>
    </div>
  );
}

function CapabilityRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-source" : "bg-caution"}`}
        aria-hidden="true"
      />
      <span className="w-[68px] shrink-0">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ink-soft">{value}</span>
    </li>
  );
}
