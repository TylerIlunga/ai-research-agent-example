/**
 * Comprehensive Mock Implementation for Vector Store (Pinecone)
 * Simulates vector operations with realistic behavior and responses
 */

import { EventEmitter } from 'events';

export interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, any>;
  values?: number[];
}

export interface QueryResponse {
  matches: VectorMatch[];
  namespace?: string;
}

export interface UpsertResponse {
  upsertedCount: number;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: Record<string, any>;
  namespace?: string;
}

export interface QueryOptions {
  topK?: number;
  filter?: Record<string, any>;
  namespace?: string;
  includeMetadata?: boolean;
  includeValues?: boolean;
}

export interface UpsertOptions {
  namespace?: string;
  batchSize?: number;
}

export class MockVectorStore extends EventEmitter {
  private vectors: Map<string, VectorRecord> = new Map();
  private queryResults: VectorMatch[] = [];
  private errorToThrow: Error | null = null;
  private delay: number = 0;
  private callCount: number = 0;
  private dimensions: number = 1536;

  // Mock data
  private defaultVectors: VectorRecord[] = [
    {
      id: 'doc_001',
      values: this.generateRandomVector(),
      metadata: {
        title: 'Introduction to Machine Learning',
        content: 'Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.',
        source: 'ml-textbook-2024',
        type: 'educational',
        domain: 'machine-learning',
        chunk_index: 0,
        published_date: '2024-01-15'
      },
      namespace: 'research-docs'
    },
    {
      id: 'doc_002',
      values: this.generateRandomVector(),
      metadata: {
        title: 'Deep Learning Fundamentals',
        content: 'Deep learning uses neural networks with multiple layers to model and understand complex patterns in data.',
        source: 'deep-learning-guide',
        type: 'technical',
        domain: 'deep-learning',
        chunk_index: 1,
        published_date: '2024-01-12'
      },
      namespace: 'research-docs'
    },
    {
      id: 'doc_003',
      values: this.generateRandomVector(),
      metadata: {
        title: 'Natural Language Processing Applications',
        content: 'NLP enables computers to understand, interpret, and generate human language in a valuable way.',
        source: 'nlp-research-2024',
        type: 'research',
        domain: 'nlp',
        chunk_index: 0,
        published_date: '2024-01-10'
      },
      namespace: 'research-docs'
    },
    {
      id: 'doc_004',
      values: this.generateRandomVector(),
      metadata: {
        title: 'Computer Vision Breakthroughs',
        content: 'Recent advances in computer vision have enabled machines to interpret and understand visual information with unprecedented accuracy.',
        source: 'cv-innovations-2024',
        type: 'news',
        domain: 'computer-vision',
        chunk_index: 2,
        published_date: '2024-01-08'
      },
      namespace: 'research-docs'
    },
    {
      id: 'doc_005',
      values: this.generateRandomVector(),
      metadata: {
        title: 'Reinforcement Learning in Robotics',
        content: 'Reinforcement learning algorithms are being successfully applied to robotic systems for autonomous navigation and manipulation tasks.',
        source: 'robotics-rl-study',
        type: 'academic',
        domain: 'robotics',
        chunk_index: 1,
        published_date: '2024-01-05'
      },
      namespace: 'research-docs'
    }
  ];

  constructor() {
    super();
    this.initializeDefaultData();
  }

  private initializeDefaultData(): void {
    this.defaultVectors.forEach(vector => {
      this.vectors.set(vector.id, vector);
    });
  }

  // Main query method
  async query(
    vector: number[],
    options: QueryOptions = {}
  ): Promise<QueryResponse> {
    this.callCount++;

    // Simulate API delay
    if (this.delay > 0) {
      await this.sleep(this.delay);
    }

    // Check for errors
    if (this.errorToThrow) {
      const error = this.errorToThrow;
      this.errorToThrow = null; // Reset after throwing
      throw error;
    }

    // Validate input
    this.validateVector(vector);

    // Generate or use pre-configured results
    let matches: VectorMatch[];
    if (this.queryResults.length > 0) {
      matches = [...this.queryResults];
      this.queryResults = []; // Use once then reset
    } else {
      matches = this.performSimilaritySearch(vector, options);
    }

    // Apply filters and limits
    matches = this.applyFilters(matches, options);
    matches = this.applyTopK(matches, options.topK || 10);

    // Include/exclude data based on options
    if (!options.includeValues) {
      matches = matches.map(match => ({ ...match, values: undefined }));
    }

    if (!options.includeMetadata) {
      matches = matches.map(match => ({ ...match, metadata: {} }));
    }

    const response: QueryResponse = {
      matches,
      namespace: options.namespace
    };

    this.emit('queryCompleted', {
      vectorDimensions: vector.length,
      resultCount: matches.length,
      namespace: options.namespace,
      callNumber: this.callCount
    });

    return response;
  }

  // Batch query method
  async batchQuery(
    vectors: number[][],
    options: QueryOptions = {}
  ): Promise<QueryResponse[]> {
    const batchStartTime = Date.now();
    
    // Process in batches to simulate realistic behavior
    const batchSize = 10;
    const results: QueryResponse[] = [];

    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      const batchPromises = batch.map(vector => this.query(vector, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    this.emit('batchQueryCompleted', {
      vectorCount: vectors.length,
      totalTime: Date.now() - batchStartTime,
      totalResults: results.reduce((sum, r) => sum + r.matches.length, 0)
    });

    return results;
  }

  // Upsert method
  async upsert(
    vectors: VectorRecord[],
    options: UpsertOptions = {}
  ): Promise<UpsertResponse> {
    this.callCount++;

    if (this.delay > 0) {
      await this.sleep(this.delay);
    }

    if (this.errorToThrow) {
      const error = this.errorToThrow;
      this.errorToThrow = null;
      throw error;
    }

    // Validate vectors
    vectors.forEach(vector => this.validateVector(vector.values));

    // Process in batches
    const batchSize = options.batchSize || 100;
    let upsertedCount = 0;

    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      
      batch.forEach(vector => {
        const record: VectorRecord = {
          ...vector,
          namespace: options.namespace || vector.namespace || 'default'
        };
        this.vectors.set(vector.id, record);
        upsertedCount++;
      });

      // Simulate batch processing delay
      if (i + batchSize < vectors.length) {
        await this.sleep(50);
      }
    }

    this.emit('upsertCompleted', {
      upsertedCount,
      namespace: options.namespace,
      callNumber: this.callCount
    });

    return { upsertedCount };
  }

  // Delete method
  async deleteVectors(
    ids: string[],
    namespace?: string
  ): Promise<{ deletedCount: number }> {
    this.callCount++;

    if (this.delay > 0) {
      await this.sleep(this.delay);
    }

    if (this.errorToThrow) {
      const error = this.errorToThrow;
      this.errorToThrow = null;
      throw error;
    }

    let deletedCount = 0;
    ids.forEach(id => {
      const vector = this.vectors.get(id);
      if (vector && (!namespace || vector.namespace === namespace)) {
        this.vectors.delete(id);
        deletedCount++;
      }
    });

    this.emit('deleteCompleted', {
      deletedCount,
      namespace,
      callNumber: this.callCount
    });

    return { deletedCount };
  }

  // Update method
  async update(
    id: string,
    values?: number[],
    metadata?: Record<string, any>,
    namespace?: string
  ): Promise<{ updated: boolean }> {
    this.callCount++;

    if (this.delay > 0) {
      await this.sleep(this.delay);
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const existingVector = this.vectors.get(id);
    if (!existingVector || (namespace && existingVector.namespace !== namespace)) {
      return { updated: false };
    }

    const updatedVector: VectorRecord = {
      ...existingVector,
      ...(values && { values }),
      ...(metadata && { metadata: { ...existingVector.metadata, ...metadata } })
    };

    this.vectors.set(id, updatedVector);

    this.emit('updateCompleted', {
      id,
      namespace,
      callNumber: this.callCount
    });

    return { updated: true };
  }

  // Fetch method
  async fetch(
    ids: string[],
    namespace?: string
  ): Promise<{ vectors: Record<string, VectorRecord> }> {
    this.callCount++;

    if (this.delay > 0) {
      await this.sleep(this.delay);
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const result: Record<string, VectorRecord> = {};
    
    ids.forEach(id => {
      const vector = this.vectors.get(id);
      if (vector && (!namespace || vector.namespace === namespace)) {
        result[id] = vector;
      }
    });

    return { vectors: result };
  }

  // Configuration methods
  setQueryResults(results: VectorMatch[]): void {
    this.queryResults = results;
  }

  setError(error: Error): void {
    this.errorToThrow = error;
  }

  setDelay(ms: number): void {
    this.delay = ms;
  }

  setDimensions(dimensions: number): void {
    this.dimensions = dimensions;
  }

  // Scenario-specific configurations
  setHighSimilarityScenario(): void {
    this.queryResults = this.defaultVectors.slice(0, 3).map((vector, index) => ({
      id: vector.id,
      score: 0.95 - index * 0.05,
      metadata: vector.metadata
    }));
  }

  setLowSimilarityScenario(): void {
    this.queryResults = this.defaultVectors.slice(0, 2).map((vector, index) => ({
      id: vector.id,
      score: 0.65 - index * 0.1,
      metadata: vector.metadata
    }));
  }

  setEmptyResultsScenario(): void {
    this.queryResults = [];
  }

  setMixedQualityScenario(): void {
    this.queryResults = [
      {
        id: 'doc_001',
        score: 0.92,
        metadata: this.defaultVectors[0].metadata
      },
      {
        id: 'doc_low_quality',
        score: 0.55,
        metadata: {
          title: 'Low Quality Document',
          content: 'This document has limited relevant information.',
          source: 'questionable-source',
          type: 'unknown'
        }
      },
      {
        id: 'doc_002',
        score: 0.88,
        metadata: this.defaultVectors[1].metadata
      }
    ];
  }

  setDomainSpecificScenario(domain: string): void {
    const domainVectors = this.defaultVectors.filter(v => 
      v.metadata.domain === domain || v.metadata.title.toLowerCase().includes(domain)
    );

    this.queryResults = domainVectors.map((vector, index) => ({
      id: vector.id,
      score: 0.90 - index * 0.05,
      metadata: vector.metadata
    }));
  }

  // Advanced search features
  async hybridSearch(
    vector: number[],
    keywords: string[],
    options: QueryOptions = {}
  ): Promise<QueryResponse> {
    // Simulate hybrid search combining vector similarity and keyword matching
    const vectorResults = await this.query(vector, options);
    
    // Boost scores for keyword matches
    const boostedResults = vectorResults.matches.map(match => {
      let boost = 0;
      const content = (match.metadata.title + ' ' + match.metadata.content).toLowerCase();
      
      keywords.forEach(keyword => {
        if (content.includes(keyword.toLowerCase())) {
          boost += 0.1;
        }
      });

      return {
        ...match,
        score: Math.min(0.99, match.score + boost)
      };
    });

    // Re-sort by boosted scores
    boostedResults.sort((a, b) => b.score - a.score);

    return {
      matches: boostedResults,
      namespace: options.namespace
    };
  }

  async searchByMetadata(
    filter: Record<string, any>,
    options: QueryOptions = {}
  ): Promise<QueryResponse> {
    const matches: VectorMatch[] = [];

    this.vectors.forEach((vector, id) => {
      if (this.matchesFilter(vector.metadata, filter)) {
        matches.push({
          id,
          score: 1.0, // Exact metadata match
          metadata: vector.metadata,
          values: options.includeValues ? vector.values : undefined
        });
      }
    });

    // Sort by relevance (can be customized)
    matches.sort((a, b) => b.score - a.score);

    return {
      matches: matches.slice(0, options.topK || 10),
      namespace: options.namespace
    };
  }

  // Private helper methods
  private performSimilaritySearch(
    queryVector: number[],
    options: QueryOptions
  ): VectorMatch[] {
    const results: VectorMatch[] = [];

    this.vectors.forEach((vector, id) => {
      // Skip if namespace doesn't match
      if (options.namespace && vector.namespace !== options.namespace) {
        return;
      }

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(queryVector, vector.values);
      
      if (similarity > 0.3) { // Threshold for relevance
        results.push({
          id,
          score: similarity,
          metadata: vector.metadata,
          values: options.includeValues ? vector.values : undefined
        });
      }
    });

    // Sort by similarity score
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }

  private cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error('Vector dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private applyFilters(matches: VectorMatch[], options: QueryOptions): VectorMatch[] {
    if (!options.filter) {
      return matches;
    }

    return matches.filter(match => 
      this.matchesFilter(match.metadata, options.filter!)
    );
  }

  private matchesFilter(metadata: Record<string, any>, filter: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) {
        // Support for range queries on dates
        if (key.endsWith('_date') && typeof value === 'object') {
          const date = new Date(metadata[key]);
          if (value.gte && date < new Date(value.gte)) return false;
          if (value.lte && date > new Date(value.lte)) return false;
          continue;
        }
        
        // Support for array contains
        if (Array.isArray(value) && value.includes(metadata[key])) {
          continue;
        }
        
        return false;
      }
    }
    return true;
  }

  private applyTopK(matches: VectorMatch[], topK: number): VectorMatch[] {
    return matches.slice(0, topK);
  }

  private validateVector(vector: number[]): void {
    if (!Array.isArray(vector)) {
      throw new Error('Vector must be an array');
    }

    if (vector.length === 0) {
      throw new Error('Vector cannot be empty');
    }

    if (vector.length !== this.dimensions) {
      throw new Error(`Vector must have ${this.dimensions} dimensions, got ${vector.length}`);
    }

    if (!vector.every(val => typeof val === 'number' && !isNaN(val))) {
      throw new Error('Vector must contain only valid numbers');
    }
  }

  private generateRandomVector(): number[] {
    return Array.from({ length: this.dimensions }, () => Math.random() * 2 - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test utilities
  getCallCount(): number {
    return this.callCount;
  }

  getVectorCount(): number {
    return this.vectors.size;
  }

  getNamespaces(): string[] {
    const namespaces = new Set<string>();
    this.vectors.forEach(vector => {
      if (vector.namespace) {
        namespaces.add(vector.namespace);
      }
    });
    return Array.from(namespaces);
  }

  clear(namespace?: string): void {
    if (namespace) {
      // Clear specific namespace
      const toDelete: string[] = [];
      this.vectors.forEach((vector, id) => {
        if (vector.namespace === namespace) {
          toDelete.push(id);
        }
      });
      toDelete.forEach(id => this.vectors.delete(id));
    } else {
      // Clear all
      this.vectors.clear();
    }
  }

  reset(): void {
    this.callCount = 0;
    this.queryResults = [];
    this.errorToThrow = null;
    this.delay = 0;
    this.vectors.clear();
    this.initializeDefaultData();
  }

  // Index statistics
  async describeIndex(): Promise<{
    dimension: number;
    indexFullness: number;
    totalVectorCount: number;
    namespaces: Record<string, { vectorCount: number }>;
  }> {
    await this.sleep(100); // Simulate API call

    const namespaces: Record<string, { vectorCount: number }> = {};
    
    this.vectors.forEach(vector => {
      const ns = vector.namespace || 'default';
      if (!namespaces[ns]) {
        namespaces[ns] = { vectorCount: 0 };
      }
      namespaces[ns].vectorCount++;
    });

    return {
      dimension: this.dimensions,
      indexFullness: Math.min(1.0, this.vectors.size / 100000), // Simulate capacity
      totalVectorCount: this.vectors.size,
      namespaces
    };
  }

  // Health check
  async healthCheck(): Promise<{ status: string; latency: number }> {
    const start = Date.now();
    await this.sleep(50);
    const latency = Date.now() - start;

    return {
      status: this.errorToThrow ? 'unhealthy' : 'healthy',
      latency
    };
  }
}