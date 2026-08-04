import crypto from "crypto";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config/env";
import { logger } from "../utils/logger";

export interface Memory {
  search(query: string, k: number): Promise<string[]>;
  save(text: string, metadata: Record<string, string>): Promise<void>;
}

let cached: Memory | null | undefined;

/**
 * Drops the memoized store so the next call rebuilds against new credentials.
 * Runtime key entry can turn memory on or off underneath a running server.
 */
export function resetMemory(): void {
  cached = undefined;
}

/**
 * Long-term memory, on the Pinecone SDK directly.
 *
 * The `@langchain/pinecone` wrapper still pins the Pinecone client to v5, so
 * using it would hold the whole project a major version behind. What it gave
 * us — upsert and similarity search — is a few lines against the v8 client.
 *
 * Memory is optional. Anthropic has no embeddings endpoint, so this is the one
 * place OpenAI is still required; without those credentials the agent
 * researches without recall rather than failing.
 */
export function getMemory(): Memory | null {
  if (cached !== undefined) return cached;

  if (!config.capabilities.memory) {
    cached = null;
    return cached;
  }

  try {
    const pinecone = new Pinecone({ apiKey: config.memory.apiKey! });
    const index = pinecone.index(config.memory.index!).namespace(config.memory.namespace);

    const embeddings = new OpenAIEmbeddings({
      apiKey: config.openai.apiKey,
      model: config.openai.embeddingModel,
      // A dead OpenAI account should surface quickly rather than stalling a
      // research run through the SDK's long default backoff.
      maxRetries: config.maxRetries,
      ...(config.openai.embeddingDimensions
        ? { dimensions: config.openai.embeddingDimensions }
        : {}),
    });

    cached = {
      async search(query, k) {
        const vector = await embeddings.embedQuery(query);
        const response = await index.query({
          vector,
          topK: k,
          includeMetadata: true,
        });

        return (response.matches ?? [])
          .map((match) => match.metadata?.text)
          .filter((text): text is string => typeof text === "string" && text.length > 0);
      },

      async save(text, metadata) {
        const [vector] = await embeddings.embedDocuments([text]);
        // v8 takes `{ records }`; v5 took a bare array.
        await index.upsert({
          records: [
            {
              id: crypto.randomUUID(),
              values: vector,
              // Pinecone metadata is flat; the note itself rides along so a
              // query can return it without a second lookup.
              metadata: { ...metadata, text, savedAt: new Date().toISOString() },
            },
          ],
        });
      },
    };
  } catch (error) {
    logger.warn("Memory unavailable, continuing without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    cached = null;
  }

  return cached;
}
