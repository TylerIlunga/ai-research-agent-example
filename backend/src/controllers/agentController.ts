import type { Request, Response } from "express";
import { createResearchAgent } from "../agents/researchAgent";

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
    const { query, conversationId }: any = req.query;

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

    // Process the stream and send data to client
    for await (const chunk of stream) {
      // Send each chunk as an SSE event
      console.log("chunk:", chunk);
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
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
