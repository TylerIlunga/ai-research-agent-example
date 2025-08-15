import {
  MemorySaver,
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { researchTools } from "../tools/research";
import {
  researchAgentPrompt,
  compressResearchSystemPrompt,
  compressResearchHumanMessage,
} from "../prompts/research";

// Initialize models
const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
});

const compressModel = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
  maxTokens: 16384,
});

// Bind tools to model
const modelWithTools = model.bindTools(researchTools);

// Initialize memory saver
const checkpointer = new MemorySaver();

// Create tool node with proper error handling
const toolNode = new ToolNode(researchTools);

// Custom tool execution node to ensure proper tool call handling
const customToolNode = async (state: typeof MessagesAnnotation.State) => {
  const lastMessage = state.messages[state.messages.length - 1];

  if (
    lastMessage &&
    lastMessage._getType() === "ai" &&
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    const toolCallIds = lastMessage.tool_calls.map(
      (toolCall: any) => toolCall.id
    );
    console.log(
      `Executing ${
        lastMessage.tool_calls.length
      } tool calls: ${toolCallIds.join(", ")}`
    );

    try {
      // Execute the tool node
      const result = await toolNode.invoke(state);

      // Verify we have proper tool message responses for each tool call
      if (result && result.messages && Array.isArray(result.messages)) {
        const toolMessageIds = result.messages
          .filter((msg) => msg._getType() === "tool")
          .map((toolMessage: any) => toolMessage.tool_call_id);

        const missingIds = toolCallIds.filter(
          (id) => !toolMessageIds.includes(id)
        );

        if (missingIds.length > 0) {
          console.warn(`Missing tool responses for: ${missingIds.join(", ")}`);
          // Create missing responses
          const missingMessages = missingIds.map(
            (id) =>
              new ToolMessage({
                content: "Tool executed but no response was generated.",
                tool_call_id: id,
              })
          );
          return { messages: [...result.messages, ...missingMessages] };
        }

        return result;
      } else {
        // If no messages returned, create responses for all tool calls
        console.warn(
          "ToolNode returned no messages, creating default responses"
        );
        const defaultMessages = lastMessage.tool_calls.map(
          (toolCall: any) =>
            new ToolMessage({
              content: "Tool executed successfully but returned no content.",
              tool_call_id: toolCall.id,
            })
        );
        return { messages: defaultMessages };
      }
    } catch (error) {
      console.error("Tool execution error:", error);
      // Create error response messages for each tool call
      const errorMessages = lastMessage.tool_calls.map(
        (toolCall: any) =>
          new ToolMessage({
            content: `Error executing tool: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            tool_call_id: toolCall.id,
          })
      );
      return { messages: errorMessages };
    }
  }

  // This should not happen as this node should only be called when there are tool calls
  console.warn("customToolNode called without tool calls");
  return { messages: [] };
};

// Agent nodes
const callModel = async (state: typeof MessagesAnnotation.State) => {
  const systemMessage = new SystemMessage({ content: researchAgentPrompt });
  const messages = [systemMessage, ...state.messages];

  const response = await modelWithTools.invoke(messages);

  return {
    messages: [response],
  };
};

const compressResearch = async (state: typeof MessagesAnnotation.State) => {
  const systemMessage = new SystemMessage({
    content: compressResearchSystemPrompt,
  });
  const humanMessage = new HumanMessage({
    content: compressResearchHumanMessage,
  });

  const currentMessages = [...state.messages];
  const lastMessage = currentMessages[currentMessages.length - 1];

  // If the last message has tool calls, remove it before compressing
  if (
    lastMessage &&
    lastMessage._getType() === "ai" &&
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0
  ) {
    currentMessages.pop();
  }

  const messages = [systemMessage, ...currentMessages, humanMessage];

  const response = await compressModel.invoke(messages);

  return {
    messages: [response],
  };
};

// Routing logic
const shouldContinue = (
  state: typeof MessagesAnnotation.State
): "tools" | "compressResearch" => {
  const lastMessage = state.messages[state.messages.length - 1];

  // Count tool iterations to prevent infinite loops
  const toolMessages = state.messages.filter(
    (msg) => msg._getType() === "tool"
  );
  const maxToolIterations = 10; // Increased limit for complex research tasks

  // Check for tool calls but limit iterations
  if (
    lastMessage &&
    lastMessage._getType() === "ai" &&
    "tool_calls" in lastMessage &&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls.length > 0 &&
    toolMessages.length < maxToolIterations
  ) {
    return "tools";
  }

  return "compressResearch";
};

// Build the research agent graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("model", callModel)
  .addNode("tools", customToolNode)
  .addNode("compressResearch", compressResearch)
  .addEdge(START, "model")
  .addConditionalEdges("model", shouldContinue, {
    tools: "tools",
    compressResearch: "compressResearch",
  })
  .addEdge("tools", "model")
  .addEdge("compressResearch", END);

// Compile the agent
const researchAgent = workflow.compile({
  checkpointer,
  recursionLimit: 25, // Keep default limit since we now have proper termination logic
});

export const createResearchAgent = async () => {
  // Function to run the agent
  const runAgent = async ({
    input,
    conversationId = "default",
  }: {
    input: string;
    conversationId: string;
  }) => {
    const initialState = {
      messages: [new HumanMessage({ content: input })],
    };

    const config = {
      configurable: { thread_id: conversationId },
    };

    const result = await researchAgent.invoke(initialState, config);

    // Extract the final response
    const finalMessage = result.messages[result.messages.length - 1];
    const output = String(finalMessage.content);

    // Extract sources from tool messages
    const sources = result.messages
      .filter((msg): msg is ToolMessage => msg._getType() === "tool")
      .filter((msg) => msg.name === "tavily_search")
      .flatMap((msg) => {
        try {
          // Extract URLs from search results content
          const content = String(msg.content);
          const urlMatches = content.match(/URL: (https?:\/\/[^\s]+)/g);
          const titleMatches = content.match(/--- SOURCE \d+: ([^-]+) ---/g);

          if (urlMatches && titleMatches) {
            return urlMatches.map((urlMatch, index) => ({
              url: urlMatch.replace("URL: ", ""),
              title:
                titleMatches[index]
                  ?.replace(/--- SOURCE \d+: ([^-]+) ---/, "$1")
                  .trim() || "Unknown Source",
            }));
          }
          return [];
        } catch (error) {
          console.error("Error parsing tool output:", error);
          return [];
        }
      });

    return {
      output,
      conversationId,
      sources: Array.from(new Map(sources.map((s) => [s.url, s])).values()),
    };
  };

  // Function to stream the agent's events
  const streamAgentEvents = async ({
    input,
    conversationId = "default",
  }: {
    input: string;
    conversationId: string;
  }) => {
    const initialState = {
      messages: [new HumanMessage({ content: input })],
    };

    const config = {
      configurable: { thread_id: conversationId },
    };

    const stream = researchAgent.streamEvents(initialState, {
      version: "v2",
      ...config,
    });

    return stream;
  };

  return {
    invoke: runAgent,
    streamEvents: streamAgentEvents,
  };
};
