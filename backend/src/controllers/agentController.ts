import type { Request, Response } from "express";
import { createResearchAgent } from "../agents/researchAgent";

// Helper function to clean complex event data
const cleanEventData = (chunk: {
  event: string;
  data?: any;
  name?: string;
  metadata?: any;
}) => {
  const { event, data, name, metadata } = chunk;

  // Extract only essential information based on event type
  switch (event) {
    case "on_chat_model_stream":
      return {
        event,
        data: {
          chunk: {
            content: data?.chunk?.content || "",
            tool_calls: data?.chunk?.tool_calls || [],
          },
        },
        name: name || "model",
        metadata: {
          langgraph_node: metadata?.langgraph_node,
          langgraph_step: metadata?.langgraph_step,
        },
      };

    case "on_chat_model_start":
    case "on_chat_model_end":
      return {
        event,
        data: {
          output: data?.output
            ? {
                content:
                  typeof data.output === "string"
                    ? data.output
                    : data.output?.content || "",
                final_answer: data.output?.final_answer,
              }
            : undefined,
        },
        name: name || "model",
        metadata: {
          langgraph_node: metadata?.langgraph_node,
          langgraph_step: metadata?.langgraph_step,
        },
      };

    case "on_tool_start":
    case "on_tool_end":
      return {
        event,
        data: {
          input: data?.input
            ? {
                query: data.input?.query || data.input,
              }
            : undefined,
          output: data?.output || undefined,
          name: data?.name,
        },
        name: name || "tool",
        metadata: {
          langgraph_node: metadata?.langgraph_node,
          langgraph_step: metadata?.langgraph_step,
        },
      };

    case "on_chain_start":
    case "on_chain_end":
      return {
        event,
        data: {
          input: data?.input
            ? {
                type: "simplified",
                message_count: data.input?.messages?.length || 0,
              }
            : undefined,
          output: data?.output || undefined,
        },
        name: name || "chain",
        metadata: {
          langgraph_node: metadata?.langgraph_node,
          langgraph_step: metadata?.langgraph_step,
        },
      };

    default:
      // For unknown events, return minimal data
      return {
        event,
        data: data ? { simplified: true } : undefined,
        name: name || "unknown",
        metadata: {
          langgraph_node: metadata?.langgraph_node,
          langgraph_step: metadata?.langgraph_step,
        },
      };
  }
};

// Helper function to determine if an event should be sent to the client
const shouldSendEvent = (chunk: {
  event: string;
  data?: any;
  metadata?: any;
}): boolean => {
  const { event, data, metadata } = chunk;

  // Always send model streaming events with content
  if (event === "on_chat_model_stream" && data?.chunk?.content) {
    return true;
  }

  // Send tool events for progress tracking
  if (event.includes("tool") && metadata?.langgraph_node) {
    return true;
  }

  // Send chain events for workflow tracking
  if (event.includes("chain") && metadata?.langgraph_node) {
    return true;
  }

  // Send final model responses
  if (event === "on_chat_model_end" && data?.output?.content) {
    return true;
  }

  // Skip other noisy events
  return false;
};

// Process a query and return the full response
export const processQuery = async (req: Request, res: Response) => {
  try {
    const { query, conversationId } = req.body;

    if (!query) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    const agent = await createResearchAgent();

    // Run the agent with the query
    const result = await agent.invoke({
      input: query,
      conversationId: conversationId || "default",
    });

    res.json({
      response: result.output,
      conversationId: result.conversationId || "default",
      sources: result.sources || [],
    });
  } catch (error) {
    console.error("Error processing query:", error);
    res.status(500).json({ error: "Failed to process query" });
  }
};

// Stream the response back to the client
export const streamResponse = async (req: Request, res: Response) => {
  try {
    const { query, conversationId } = req.query as {
      query?: string;
      conversationId?: string;
    };

    if (!query) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const agent = await createResearchAgent();

    // Stream the agent's thinking process and results
    const stream = await agent.streamEvents({
      input: query,
      conversationId: conversationId || "default",
    });

    // Process the stream and send cleaned data to client
    for await (const chunk of stream) {
      // Filter and clean the chunk to remove complex nested objects
      const cleanedChunk = cleanEventData(chunk);

      // Only send relevant events to reduce noise
      if (shouldSendEvent(cleanedChunk)) {
        console.log("Sending cleaned chunk:", cleanedChunk);
        res.write(`data: ${JSON.stringify(cleanedChunk)}\n\n`);
      }
    }

    // End the response
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Error streaming response:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred" })}\n\n`);
    res.end();
  }
};
