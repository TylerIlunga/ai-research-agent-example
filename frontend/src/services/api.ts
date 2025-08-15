// API service for interacting with the backend
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface StreamChunk {
  event: string;
  data: {
    chunk?: {
      content?: string;
      tool_calls?: unknown[];
    };
    output?: {
      content?: string;
      final_answer?: string;
    };
    input?: {
      query?: string;
    };
    name?: string;
  };
  name?: string;
  metadata?: {
    langgraph_node?: string;
  };
}

// Function to stream a query to the agent
export const streamQuery = (
  query: string,
  onChunk: (chunk: StreamChunk) => void,
  onError: (error: Error) => void,
  conversationId?: string
) => {
  const eventSource = new EventSource(
    `${API_URL}/api/agent/stream?query=${encodeURIComponent(query)}${
      conversationId ? `&conversationId=${conversationId}` : ""
    }`
  );

  eventSource.onmessage = (event) => {
    if (event.data === "[DONE]") {
      eventSource.close();
      return;
    }

    try {
      const chunk = JSON.parse(event.data);
      onChunk(chunk);
    } catch (error) {
      onError(error as Error);
    }
  };

  eventSource.onerror = (error: Event | Error) => {
    eventSource.close();
    onError(error as Error);
  };

  return {
    close: () => eventSource.close(),
  };
};
