import {
  PROTOCOL_VERSION,
  type Health,
  type ResearchEvent,
  type RuntimeKey,
} from "@/types/chat";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const response = await fetch(`${API_URL}/healthz`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}

/**
 * Sends credentials to the server, which holds them in memory for its own
 * lifetime. Pass `null` to clear a slot. The server never returns a value
 * back — only which slots are now filled.
 */
export async function saveKeys(
  updates: Partial<Record<RuntimeKey, string | null>>
): Promise<Health> {
  const response = await fetch(`${API_URL}/api/agent/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<Health> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? `The server rejected the update (${response.status}).`);
  }
  return payload as Health;
}

export class ProtocolMismatchError extends Error {
  constructor(readonly received: number) {
    super(
      `This page expects protocol v${PROTOCOL_VERSION} but the server speaks v${received}. Reload to pick up the new client.`
    );
    this.name = "ProtocolMismatchError";
  }
}

/**
 * Streams a research run.
 *
 * POST rather than EventSource: questions stay out of URLs and server logs,
 * there is no URL length ceiling, and the caller gets a real AbortController
 * so closing the tab or pressing Stop actually halts the run server-side.
 */
export async function streamResearch(options: {
  query: string;
  conversationId: string;
  signal: AbortSignal;
  onEvent: (event: ResearchEvent) => void;
}): Promise<void> {
  const { query, conversationId, signal, onEvent } = options;

  const response = await fetch(`${API_URL}/api/agent/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ query, conversationId }),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `The server responded ${response.status}.`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new Error(message);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      // SSE frames are separated by a blank line. Anything left in the buffer
      // is a partial frame and waits for the next chunk.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const payload = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        // Comment frames (": keep-alive") carry no data field.
        if (!payload) continue;

        let event: ResearchEvent;
        try {
          event = JSON.parse(payload) as ResearchEvent;
        } catch {
          continue;
        }

        if (event.type === "open" && event.protocol !== PROTOCOL_VERSION) {
          throw new ProtocolMismatchError(event.protocol);
        }

        onEvent(event);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
