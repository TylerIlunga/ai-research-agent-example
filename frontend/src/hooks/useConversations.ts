"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Conversation, Turn } from "@/types/chat";

const STORAGE_KEY = "research-agent.conversations.v1";
const MAX_STORED = 40;

function newConversation(): Conversation {
  const now = Date.now();
  return { id: uuidv4(), title: "New research", createdAt: now, updatedAt: now, turns: [] };
}

function load(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Conversation history, kept in localStorage.
 *
 * The server checkpoints threads by id so follow-up questions keep their
 * context; this is the browser's half of that — the list, the titles, and the
 * transcript to re-render on reload. Nothing leaves the device.
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  /**
   * State, not a ref. A ref flipped inside the hydrate effect would already be
   * true when the persist effect runs in that same commit — while
   * `conversations` is still the empty initial value — and the persist effect
   * would overwrite stored history with `[]`.
   */
  const [hydrated, setHydrated] = useState(false);

  // Hydrate after mount so server and client render the same first paint.
  useEffect(() => {
    const stored = load();
    if (stored.length > 0) {
      setConversations(stored);
      setActiveId(stored[0].id);
    } else {
      const fresh = newConversation();
      setConversations([fresh]);
      setActiveId(fresh.id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      // Truncate by recency, not array position: an actively used conversation
      // must not fall off the end just because it was created long ago.
      const keep = [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_STORED);
      const order = new Set(keep.map((item) => item.id));
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(conversations.filter((item) => order.has(item.id)))
      );
    } catch {
      // Quota exceeded or storage disabled — history is a convenience, not a
      // requirement, so a failure here must not interrupt research.
    }
  }, [conversations, hydrated]);

  const active = conversations.find((item) => item.id === activeId) ?? null;

  const startNew = useCallback(() => {
    const fresh = newConversation();
    setConversations((previous) => [fresh, ...previous]);
    setActiveId(fresh.id);
    return fresh.id;
  }, []);

  const remove = useCallback(
    (id: string) => {
      // Computed outside the updater. React double-invokes updaters in
      // development, so a `setActiveId` nested inside this one would run twice
      // against two different candidate lists and could orphan `activeId`.
      const next = conversations.filter((item) => item.id !== id);
      const list = next.length > 0 ? next : [newConversation()];
      setConversations(list);
      setActiveId((current) => (current === id ? list[0].id : current));
    },
    [conversations]
  );

  /** Applies a change to one turn, bumping the conversation's ordering. */
  const updateTurn = useCallback(
    (conversationId: string, turnId: string, patch: (turn: Turn) => Turn) => {
      setConversations((previous) =>
        previous.map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          return {
            ...conversation,
            updatedAt: Date.now(),
            turns: conversation.turns.map((turn) => (turn.id === turnId ? patch(turn) : turn)),
          };
        })
      );
    },
    []
  );

  const appendTurn = useCallback((conversationId: string, turn: Turn) => {
    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        // The first question names the conversation.
        const title =
          conversation.turns.length === 0
            ? turn.question.slice(0, 70) + (turn.question.length > 70 ? "…" : "")
            : conversation.title;
        return {
          ...conversation,
          title,
          updatedAt: Date.now(),
          turns: [...conversation.turns, turn],
        };
      })
    );
  }, []);

  return {
    conversations,
    active,
    activeId,
    setActiveId,
    startNew,
    remove,
    appendTurn,
    updateTurn,
    ready: conversations.length > 0,
  };
}
