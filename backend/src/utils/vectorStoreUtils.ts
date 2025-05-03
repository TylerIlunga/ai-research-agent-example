import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Pinecone } from "@pinecone-database/pinecone";
import { Document } from "langchain/document";

// Initialize Pinecone client
const pinecone = new Pinecone();
const pineconeIndex = pinecone
  .Index(process.env.PINECONE_INDEX || "")
  .namespace(process.env.PINECONE_INDEX_NAMESPACE || "default");

// Initialize embeddings
const embeddings = new OpenAIEmbeddings({
  modelName: "text-embedding-3-small",
});

// Functions for managing the vector store
export const vectorStoreUtils = {
  // Initialize a vector store with a specific namespace
  initVectorStore: async (namespace: string = "default") => {
    return PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      namespace,
    });
  },

  // Add documents to the vector store
  addDocuments: async (
    documents: Document[],
    namespace: string = "default"
  ) => {
    const vectorStore = await vectorStoreUtils.initVectorStore(namespace);
    return vectorStore.addDocuments(documents);
  },

  // Search the vector store for similar documents
  similaritySearch: async (
    query: string,
    k: number = 4,
    namespace: string = "default"
  ) => {
    const vectorStore = await vectorStoreUtils.initVectorStore(namespace);
    return vectorStore.similaritySearch(query, k);
  },

  // Delete documents from the vector store by ID
  deleteDocuments: async (ids: string[]) => {
    await pineconeIndex.deleteMany(ids);
    return true;
  },

  // Clear all documents from a namespace
  clearNamespace: async () => {
    await pineconeIndex.deleteAll();
    return true;
  },
};
