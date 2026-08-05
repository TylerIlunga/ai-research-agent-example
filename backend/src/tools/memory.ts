import crypto from "crypto";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config/env";
import { logger } from "../utils/logger";

export interface Memory {
  search(query: string, k: number, signal?: AbortSignal): Promise<string[]>;
  save(text: string, metadata: Record<string, string>, signal?: AbortSignal): Promise<void>;
}

let cached: Memory | null | undefined;

const MEMORY_TIMEOUT_MS = 15_000;

/**
 * Neither the Pinecone v8 client nor the embeddings SDK accepts an
 * AbortSignal, so a black-holed connection would otherwise hold the agent
 * loop — and the SSE response behind it — open indefinitely, and pressing
 * Stop would not release it. Racing the call against the run's signal plus a
 * hard deadline unblocks the run; the underlying request is left to die on
 * its own, which is fine for an optional subsystem.
 */
function bounded<T>(work: Promise<T>, what: string, signal?: AbortSignal): Promise<T> {
  const limit = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(MEMORY_TIMEOUT_MS)])
    : AbortSignal.timeout(MEMORY_TIMEOUT_MS);

  return new Promise<T>((resolve, reject) => {
    const fail = () => reject(new Error(`${what} timed out or was cancelled`));
    if (limit.aborted) return fail();
    limit.addEventListener("abort", fail, { once: true });
    work.then(
      (value) => {
        limit.removeEventListener("abort", fail);
        resolve(value);
      },
      (error) => {
        limit.removeEventListener("abort", fail);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

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
      async search(query, k, signal) {
        const response = await bounded(
          (async () => {
            const vector = await embeddings.embedQuery(query);
            return index.query({ vector, topK: k, includeMetadata: true });
          })(),
          "Memory lookup",
          signal
        );

        return (response.matches ?? [])
          .map((match) => match.metadata?.text)
          .filter((text): text is string => typeof text === "string" && text.length > 0);
      },

      async save(text, metadata, signal) {
        await bounded(
          (async () => {
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
          })(),
          "Memory save",
          signal
        );
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
