// API service for interacting with the backend
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface QueryResponse {
  response: string;
  conversationId: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
}

export interface StreamChunk {
  event: string;
  data: any;
}

// Function to send a query to the agent
export const sendQuery = async (
  query: string,
  conversationId?: string
): Promise<QueryResponse> => {
  const response = await fetch(`${API_URL}/api/agent/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, conversationId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "An error occurred");
  }

  return response.json();
};

// Function to stream a response from the agent
export const streamResponse = (
  query: string,
  conversationId?: string,
  callbacks?: {
    onChunk: (chunk: StreamChunk) => void;
    onDone: () => void;
    onError: (error: Error) => void;
  }
) => {
  const eventSource = new EventSource(
    `${API_URL}/api/agent/stream?query=${encodeURIComponent(query)}${
      conversationId ? `&conversationId=${conversationId}` : ""
    }`
  );

  eventSource.onmessage = (event) => {
    if (event.data === "[DONE]") {
      eventSource.close();
      callbacks?.onDone();
      return;
    }

    try {
      const chunk = JSON.parse(event.data);
      console.log("Received event:", chunk); // Debugging

      // Handle LangGraph events
      if (chunk.event === "on_chain_stream") {
        // Extract text from LangGraph stream
        if (chunk.data?.chunk?.model?.messages?.kwargs?.content) {
          callbacks?.onChunk({
            event: "text",
            data: {
              text: chunk.data.chunk.model.messages.kwargs.content,
            },
          });
        }

        // Extract sources if present in the message
        // Can be extracted from markdown-formatted text at the end of the content
        const content =
          chunk.data?.chunk?.model?.messages?.kwargs?.content || "";
        if (content.includes("Sources:")) {
          const sourcesSection = content.split("Sources:")[1];
          // Parse markdown links: [title](url)
          const sourceMatches = sourcesSection.matchAll(
            /\[([^\]]+)\]\(([^)]+)\)/g
          );

          const sources = Array.from(sourceMatches).map((match: any) => ({
            title: match[1],
            url: match[2],
          }));

          if (sources.length > 0) {
            callbacks?.onChunk({
              event: "sources",
              data: {
                sources,
              },
            });
          }
        }
      }
      // You can add handling for on_chain_end event if needed
    } catch (error) {
      callbacks?.onError(error as Error);
    }
  };

  eventSource.onerror = (error: any) => {
    eventSource.close();
    callbacks?.onError(error as Error);
  };

  return {
    close: () => eventSource.close(),
  };
};
