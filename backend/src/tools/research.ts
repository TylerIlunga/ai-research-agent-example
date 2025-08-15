import dotenv from "dotenv";

// Load environment variables first
dotenv.config();

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { TavilySearch } from "@langchain/tavily";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { SummarySchema } from "../types/state";
import { summarizeWebpagePrompt } from "../prompts/research";
import { PineconeStore } from "@langchain/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { Pinecone } from "@pinecone-database/pinecone";

// Initialize Pinecone for memory storage
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || "");

const embeddings = new OpenAIEmbeddings({
  modelName: "text-embedding-ada-002", // Uses 1024 dimensions to match Pinecone index
});

// Initialize vector store
let vectorStore: PineconeStore | null = null;

const getVectorStore = async (): Promise<PineconeStore> => {
  if (!vectorStore) {
    vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace: "research-agent",
    });
  }
  return vectorStore;
};

// Initialize models
const summarizationModel = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
});

// Initialize Tavily search
const tavilySearch = new TavilySearch({
  maxResults: 3,
  includeAnswer: true,
  includeRawContent: true,
});

// Helper function to summarize webpage content
const summarizeWebpageContent = async (
  webpageContent: string
): Promise<string> => {
  try {
    const structuredModel =
      summarizationModel.withStructuredOutput(SummarySchema);

    const summary = await structuredModel.invoke([
      new HumanMessage({
        content: summarizeWebpagePrompt.replace(
          "{webpage_content}",
          webpageContent
        ),
      }),
    ]);

    return `<summary>\n${summary.summary}\n</summary>\n\n<key_excerpts>\n${summary.keyExcerpts}\n</key_excerpts>`;
  } catch (error) {
    console.error("Failed to summarize webpage:", error);
    return webpageContent.length > 1000
      ? webpageContent.substring(0, 1000) + "..."
      : webpageContent;
  }
};

// Helper function to process search results
const processSearchResults = async (results: any[]): Promise<string> => {
  if (!results || results.length === 0) {
    return "No valid search results found. Please try different search queries.";
  }

  let formattedOutput = "Search results:\n\n";

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    // Use existing content if no raw content for summarization
    let content = result.content;
    if (result.raw_content) {
      content = await summarizeWebpageContent(result.raw_content);
    }

    formattedOutput += `\n\n--- SOURCE ${i + 1}: ${result.title} ---\n`;
    formattedOutput += `URL: ${result.url}\n\n`;
    formattedOutput += `SUMMARY:\n${content}\n\n`;
    formattedOutput += "-".repeat(80) + "\n";
  }

  return formattedOutput;
};

// Enhanced Tavily search tool
export const tavilySearchTool = tool(
  async ({ query }: { query: string }) => {
    try {
      // TavilySearch expects an object with a query property
      const searchResults = await tavilySearch.invoke({ query });

      // Process and format results
      const processedResults = await processSearchResults(searchResults);

      return processedResults;
    } catch (error) {
      console.error("Search error:", error);
      return `Search failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
    }
  },
  {
    name: "tavily_search",
    description:
      "Fetch results from Tavily search API with content summarization. Use this to search for current information on the web.",
    schema: z.object({
      query: z.string().describe("A single search query to execute"),
    }),
  }
);

// Thinking tool for reflection
export const thinkTool = tool(
  async ({ reflection }: { reflection: string }) => {
    return `Reflection recorded: ${reflection}`;
  },
  {
    name: "think_tool",
    description:
      "Tool for strategic reflection on research progress and decision-making. Use this tool after each search to analyze results and plan next steps systematically.",
    schema: z.object({
      reflection: z
        .string()
        .describe(
          "Your detailed reflection on research progress, findings, gaps, and next steps"
        ),
    }),
  }
);

// Memory tools
export const saveToMemoryTool = tool(
  async ({ information }: { information: string }) => {
    try {
      const store = await getVectorStore();
      await store.addDocuments([
        {
          pageContent: information,
          metadata: { source: "agent", timestamp: Date.now() },
        },
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
    schema: z.object({
      information: z.string().describe("The information to save to memory"),
    }),
  }
);

export const retrieveFromMemoryTool = tool(
  async ({ query }: { query: string }) => {
    try {
      const store = await getVectorStore();
      const results = await store.similaritySearch(query, 3);
      return JSON.stringify(results.map((doc) => doc.pageContent));
    } catch (error) {
      console.error("Error retrieving from memory:", error);
      return "Failed to retrieve information from memory";
    }
  },
  {
    name: "retrieve_from_memory",
    description: "Retrieve relevant information from memory based on the query",
    schema: z.object({
      query: z.string().describe("The query to search for in memory"),
    }),
  }
);

// Export all tools as an array
export const researchTools = [
  tavilySearchTool,
  thinkTool,
  saveToMemoryTool,
  retrieveFromMemoryTool,
];
