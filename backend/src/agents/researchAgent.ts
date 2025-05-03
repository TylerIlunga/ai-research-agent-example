import {
  MemorySaver,
  StateGraph,
  Annotation,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StringOutputParser } from "@langchain/core/output_parsers";

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Initialize Pinecone client
const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || "");

// Initialize embeddings for vector storage
const embeddings = new OpenAIEmbeddings({
  modelName: "text-embedding-3-small",
});

// Initialize the vector store for memory
const initVectorStore = async () => {
  return await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    namespace: "research-agent",
  });
};

export const createResearchAgent = async () => {
  // Initialize tools
  const searchTool = new TavilySearch({
    maxResults: 5,
    topic: "general",
  });

  const vectorStore = await initVectorStore();

  // const getWeather = tool(
  //   (input) => {
  //     if (["sf", "san francisco"].includes(input.location.toLowerCase())) {
  //       return "It's 60 degrees and foggy.";
  //     } else {
  //       return "It's 90 degrees and sunny.";
  //     }
  //   },
  //   {
  //     name: "get_weather",
  //     description: "Call to get the current weather.",
  //     schema: z.object({
  //       location: z.string().describe("Location to get the weather for."),
  //     }),
  //   }
  // );

  // Custom tool for saving information to memory
  const saveToMemoryTool = tool(
    async ({ information }: { information: string }) => {
      try {
        // Convert the information to embeddings and store in Pinecone
        await vectorStore.addDocuments([
          { pageContent: information, metadata: { source: "agent" } },
        ]);
        return "Information saved to memory successfully";
      } catch (error) {
        console.error("Error saving to memory:", error);
        return "Failed to save information to memory";
      }
    },
    {
      name: "save_to_memory",
      description:
        "Save important information to long-term memory for future reference",
      schema: z
        .object({
          information: z.string().describe("The information to save to memory"),
        })
        .required(),
    }
  );

  // Custom tool for retrieving from memory
  const retrieveFromMemoryTool = tool(
    async ({ query }: { query: string }) => {
      try {
        const results = await vectorStore.similaritySearch(query, 3);
        return JSON.stringify(results.map((doc) => doc.pageContent));
      } catch (error) {
        console.error("Error retrieving from memory:", error);
        return "Failed to retrieve information from memory";
      }
    },
    {
      name: "retrieve_from_memory",
      description:
        "Retrieve relevant information from memory based on the query",
      schema: z
        .object({
          query: z.string().describe("The query to search for in memory"),
        })
        .required(),
    }
  );

  // Set up the model with tools
  const model = new ChatOpenAI({
    // modelName: "gpt-4o-mini",
    model: "gpt-4o",
    temperature: 0,
  }).bindTools([searchTool, saveToMemoryTool, retrieveFromMemoryTool]);

  // Create tool node for executing tool calls
  const tools = [searchTool, saveToMemoryTool, retrieveFromMemoryTool];
  const toolNode = new ToolNode(tools);

  // Define the agent state using Annotation.Root
  const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) => {
        if (Array.isArray(right)) {
          return left.concat(right);
        }
        return left.concat([right]);
      },
      default: () => [],
    }),
    conversationId: Annotation<string>(),
  });

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const { messages } = state;
    const response = await model.invoke(messages);
    return { messages: response };
  };

  // Define the logic for deciding whether to continue or finish
  const shouldContinue = (state: any) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];

    console.log("shouldContinue:", messages);

    if (
      "tool_calls" in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls?.length
    ) {
      return "tools";
    }
    return END;
  };

  // Add edges to the graph
  // Example Graph:
  // START => "model" => shouldContinue("tools" || "end")
  // "tool" => "model" (above) [loop between "model" and "tools"]
  // Create the graph for the agent
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("model", callModel) // Add nodes to the graph
    .addNode("tools", toolNode) // Add the ToolNode instance directly as a node
    .addEdge(START, "model" as any) // Use addEdge(START, key) instead of setEntryPoint
    .addConditionalEdges("model" as any, shouldContinue, ["tools", END] as any)
    .addEdge("tools" as any, "model" as any);

  // Compile the graph
  const graph = workflow.compile();

  // Initialize the memory saver for persistence
  const checkpointer = new MemorySaver();

  // Function to run the agent
  const runAgent = async ({
    input,
    conversationId = "default",
  }: {
    input: string;
    conversationId: string;
  }) => {
    // Retrieve previous messages if any
    let existingState;
    try {
      // checkpointer.get expects a config object with a configurable key
      existingState = await checkpointer.get({
        configurable: { thread_id: conversationId },
      });
    } catch (e) {
      existingState = null;
    }

    // Initialize state
    // Use the correct state type here
    const initialState: any = existingState || {
      messages: [
        new SystemMessage(
          `You are a helpful research assistant that can search the web for information and provide detailed, accurate answers.
          You have access to tools that allow you to search the web and access your memory.
          Always cite your sources at the end of your response.`
        ),
        new HumanMessage(input),
      ],
      conversationId,
    };

    // Run the graph
    // graph.invoke expects a state object and optionally a config object
    // Use the correct state type for the result
    const result: any = await graph.invoke(initialState, {
      configurable: { thread_id: conversationId },
    });

    // Save the state
    // checkpointer.put expects a config object with a configurable key and the state
    // await checkpointer.put(
    //   { configurable: { thread_id: conversationId } },
    //   result
    // );

    // Extract the final AI message
    const finalMessage = result.messages[
      result.messages.length - 1
    ] as AIMessage;

    console.log("result.messages (all generated messages):", result.messages); // Corrected typo messaegs -> messages
    console.log("finalMessage:", finalMessage);

    // Extract sources from the messages if available
    const sources = result.messages
      .filter((msg: any): msg is ToolMessage => msg._getType() === "tool") // Filter for ToolMessages
      .filter((msg: any) => msg.name === searchTool.name) // Filter for messages from the search tool
      .flatMap((msg: any) => {
        try {
          // Assuming the output of the tavily_search_results tool is a JSON string of results
          // Ensure content is treated as string for JSON.parse
          const results = JSON.parse(msg.content as string);
          if (Array.isArray(results)) {
            return results.map((result: any) => ({
              title: result.title || "Unknown Source",
              url: result.url,
            }));
          }
          return [];
        } catch (e) {
          console.error("Error parsing tool output:", e);
          return [];
        }
      });

    console.log("sources:", sources);

    return {
      output: finalMessage.content,
      conversationId,
      // Use the correct type for the map function
      sources: [
        ...new Map(
          sources.map((s: { url: string; title: string }) => [s.url, s])
        ).values(),
      ], // Deduplicate sources
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
    // Retrieve previous messages if any
    let existingState;
    try {
      // checkpointer.get expects a config object with a configurable key
      existingState = await checkpointer.get({
        configurable: { thread_id: conversationId },
      });
    } catch (e) {
      existingState = null;
    }

    // Initialize state
    // Use the correct state type here
    const initialState: any = existingState || {
      messages: [
        new SystemMessage(
          `You are a helpful research assistant that can search the web for information and provide detailed, accurate answers.
          You have access to tools that allow you to search the web and access your memory.
          Always cite your sources at the end of your response.`
        ),
        new HumanMessage(input),
      ],
      conversationId,
    };

    // Stream the events
    // graph.streamEvents expects a state object and optionally a config object
    const stream = graph.streamEvents(initialState, {
      version: "v2",
      configurable: { thread_id: conversationId }, // Pass conversationId in configurable
    });

    return stream;
  };

  return {
    invoke: runAgent,
    streamEvents: streamAgentEvents,
  };
};
