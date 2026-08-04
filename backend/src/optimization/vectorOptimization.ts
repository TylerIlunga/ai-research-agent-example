/**
 * Vector Database Performance Optimization for AI Research Agent
 * 
 * Implements advanced optimization strategies for Pinecone vector operations
 * including intelligent caching, query optimization, and batch processing.
 */

import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';

export interface VectorOptimizationConfig {
  cacheSize: number;
  cacheTTL: number;
  batchSize: number;
  maxRetries: number;
  queryTimeout: number;
  similarityThreshold: number;
  enableQueryOptimization: boolean;
  enableBatching: boolean;
  enableCaching: boolean;
  enableCompression: boolean;
}

export interface QueryMetrics {
  totalQueries: number;
  cacheHits: number;
  cacheMisses: number;
  avgQueryTime: number;
  avgResultsCount: number;
  errorRate: number;
  compressionRatio: number;
  batchEfficiency: number;
}

export class VectorOptimizer extends EventEmitter {
  private config: VectorOptimizationConfig;
  private queryCache: LRUCache<string, CachedResult>;
  private vectorCache: LRUCache<string, Float32Array>;
  private batchQueue: QueryBatch[] = [];
  private metrics: QueryMetrics;
  private batchProcessor: NodeJS.Timeout | null = null;

  constructor(config: Partial<VectorOptimizationConfig> = {}) {
    super();
    
    this.config = {
      cacheSize: 10000,
      cacheTTL: 3600000, // 1 hour
      batchSize: 100,
      maxRetries: 3,
      queryTimeout: 30000,
      similarityThreshold: 0.8,
      enableQueryOptimization: true,
      enableBatching: true,
      enableCaching: true,
      enableCompression: true,
      ...config
    };

    this.queryCache = new LRUCache({
      max: this.config.cacheSize,
      ttl: this.config.cacheTTL,
      updateAgeOnGet: true
    });

    this.vectorCache = new LRUCache({
      max: this.config.cacheSize / 2,
      ttl: this.config.cacheTTL * 2 // Vectors cached longer
    });

    this.metrics = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      avgQueryTime: 0,
      avgResultsCount: 0,
      errorRate: 0,
      compressionRatio: 0,
      batchEfficiency: 0
    };

    this.initializeBatchProcessor();
  }

  /**
   * Optimized vector query with caching and batch processing
   */
  async optimizedQuery(
    vector: number[] | Float32Array,
    options: {
      topK?: number;
      filter?: Record<string, any>;
      namespace?: string;
      includeMetadata?: boolean;
      priority?: number;
    } = {}
  ): Promise<QueryResult> {
    const startTime = performance.now();
    this.metrics.totalQueries++;

    const queryOptions = {
      topK: 10,
      includeMetadata: true,
      priority: 0,
      ...options
    };

    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(vector, queryOptions);

      // Check cache first
      if (this.config.enableCaching) {
        const cachedResult = this.queryCache.get(cacheKey);
        if (cachedResult && this.isCacheValid(cachedResult)) {
          this.metrics.cacheHits++;
          this.updateMetrics(performance.now() - startTime, cachedResult.results.length);
          
          this.emit('cacheHit', {
            cacheKey,
            resultCount: cachedResult.results.length
          });

          return {
            matches: cachedResult.results,
            responseTime: performance.now() - startTime,
            fromCache: true
          };
        }
        this.metrics.cacheMisses++;
      }

      // Optimize vector if enabled
      const optimizedVector = this.config.enableQueryOptimization 
        ? await this.optimizeVector(vector)
        : vector;

      // Execute query (batched or immediate)
      let result: QueryResult;
      
      if (this.config.enableBatching && queryOptions.priority < 5) {
        result = await this.addToBatch(optimizedVector, queryOptions);
      } else {
        result = await this.executeDirectQuery(optimizedVector, queryOptions);
      }

      // Cache result if enabled
      if (this.config.enableCaching && result.matches.length > 0) {
        const cachedResult: CachedResult = {
          results: result.matches,
          timestamp: Date.now(),
          queryOptions,
          expiresAt: Date.now() + this.config.cacheTTL
        };
        
        this.queryCache.set(cacheKey, cachedResult);
      }

      const responseTime = performance.now() - startTime;
      this.updateMetrics(responseTime, result.matches.length);

      this.emit('queryCompleted', {
        responseTime,
        resultCount: result.matches.length,
        fromCache: false,
        batched: this.config.enableBatching && queryOptions.priority < 5
      });

      return {
        ...result,
        responseTime,
        fromCache: false
      };

    } catch (error) {
      this.metrics.errorRate = (this.metrics.errorRate * (this.metrics.totalQueries - 1) + 1) / this.metrics.totalQueries;
      
      this.emit('queryError', {
        error: error.message,
        responseTime: performance.now() - startTime
      });

      throw new Error(`Vector query failed: ${error.message}`);
    }
  }

  /**
   * Batch multiple vectors for efficient processing
   */
  async batchQuery(
    vectors: (number[] | Float32Array)[],
    options: {
      topK?: number;
      filter?: Record<string, any>;
      namespace?: string;
      includeMetadata?: boolean;
    } = {}
  ): Promise<BatchQueryResult[]> {
    const startTime = performance.now();
    
    if (!this.config.enableBatching) {
      // Fall back to individual queries
      const results = await Promise.all(
        vectors.map(vector => this.optimizedQuery(vector, options))
      );
      return results.map((result, index) => ({
        ...result,
        index
      }));
    }

    try {
      // Process in chunks
      const batchSize = this.config.batchSize;
      const chunks = this.chunkArray(vectors, batchSize);
      const allResults: BatchQueryResult[] = [];

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const chunkResults = await this.processBatchChunk(chunk, options);
        
        // Add global indices
        chunkResults.forEach((result, localIndex) => {
          allResults.push({
            ...result,
            index: chunkIndex * batchSize + localIndex
          });
        });
      }

      const batchEfficiency = this.calculateBatchEfficiency(vectors.length, performance.now() - startTime);
      this.metrics.batchEfficiency = (this.metrics.batchEfficiency + batchEfficiency) / 2;

      this.emit('batchCompleted', {
        vectorCount: vectors.length,
        totalTime: performance.now() - startTime,
        efficiency: batchEfficiency
      });

      return allResults;

    } catch (error) {
      this.emit('batchError', {
        error: error.message,
        vectorCount: vectors.length
      });
      throw error;
    }
  }

  /**
   * Optimize vector for better query performance
   */
  private async optimizeVector(vector: number[] | Float32Array): Promise<Float32Array> {
    const vectorArray = vector instanceof Float32Array ? vector : new Float32Array(vector);
    
    // Check vector cache
    const vectorKey = this.generateVectorKey(vectorArray);
    const cachedVector = this.vectorCache.get(vectorKey);
    if (cachedVector) {
      return cachedVector;
    }

    // Normalize vector
    const normalizedVector = this.normalizeVector(vectorArray);
    
    // Apply dimensionality reduction if needed (for very high-dimensional vectors)
    const optimizedVector = normalizedVector.length > 2048 
      ? await this.reduceDimensionality(normalizedVector)
      : normalizedVector;

    // Compress if enabled
    const finalVector = this.config.enableCompression 
      ? await this.compressVector(optimizedVector)
      : optimizedVector;

    // Cache optimized vector
    this.vectorCache.set(vectorKey, finalVector);

    return finalVector;
  }

  /**
   * Normalize vector to unit length
   */
  private normalizeVector(vector: Float32Array): Float32Array {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude === 0) return vector;
    
    return new Float32Array(vector.map(val => val / magnitude));
  }

  /**
   * Reduce vector dimensionality for performance
   */
  private async reduceDimensionality(vector: Float32Array): Promise<Float32Array> {
    // Simple PCA-like dimensionality reduction
    // In production, use more sophisticated methods
    const targetDim = 1536; // Standard embedding dimension
    
    if (vector.length <= targetDim) return vector;
    
    const step = vector.length / targetDim;
    const reduced = new Float32Array(targetDim);
    
    for (let i = 0; i < targetDim; i++) {
      const sourceIndex = Math.floor(i * step);
      reduced[i] = vector[sourceIndex];
    }
    
    return this.normalizeVector(reduced);
  }

  /**
   * Compress vector using quantization
   */
  private async compressVector(vector: Float32Array): Promise<Float32Array> {
    // 8-bit quantization for storage efficiency
    const min = Math.min(...vector);
    const max = Math.max(...vector);
    const range = max - min;
    
    if (range === 0) return vector;
    
    const compressed = new Float32Array(vector.length);
    
    for (let i = 0; i < vector.length; i++) {
      // Quantize to 8-bit and back to float
      const quantized = Math.round(((vector[i] - min) / range) * 255);
      compressed[i] = (quantized / 255) * range + min;
    }
    
    const compressionRatio = 1 - (compressed.byteLength / vector.byteLength);
    this.metrics.compressionRatio = (this.metrics.compressionRatio + compressionRatio) / 2;
    
    return compressed;
  }

  /**
   * Execute direct query to Pinecone
   */
  private async executeDirectQuery(
    vector: number[] | Float32Array,
    options: any
  ): Promise<QueryResult> {
    // Simulate Pinecone query - replace with actual implementation
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() > 0.95) { // 5% error rate simulation
          reject(new Error('Vector database timeout'));
          return;
        }

        const matches = this.generateMockMatches(options.topK || 10);
        resolve({
          matches,
          responseTime: 0 // Will be calculated by caller
        });
      }, Math.random() * 100 + 50); // 50-150ms latency
    });
  }

  /**
   * Add query to batch for processing
   */
  private async addToBatch(
    vector: number[] | Float32Array,
    options: any
  ): Promise<QueryResult> {
    return new Promise((resolve, reject) => {
      const batchItem: BatchItem = {
        vector,
        options,
        resolve,
        reject,
        timestamp: Date.now(),
        timeout: setTimeout(() => {
          reject(new Error('Batch query timeout'));
        }, this.config.queryTimeout)
      };

      // Find or create batch
      let batch = this.batchQueue.find(b => 
        b.items.length < this.config.batchSize &&
        this.areBatchCompatible(b.options, options)
      );

      if (!batch) {
        batch = {
          id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          items: [],
          options: { ...options },
          createdAt: Date.now()
        };
        this.batchQueue.push(batch);
      }

      batch.items.push(batchItem);

      // Process batch if full or timeout
      if (batch.items.length >= this.config.batchSize) {
        this.processBatch(batch);
      }
    });
  }

  /**
   * Initialize batch processor
   */
  private initializeBatchProcessor(): void {
    this.batchProcessor = setInterval(() => {
      this.processExpiredBatches();
    }, 100); // Check every 100ms
  }

  /**
   * Process expired batches
   */
  private processExpiredBatches(): void {
    const now = Date.now();
    const expiredBatches = this.batchQueue.filter(
      batch => now - batch.createdAt > 1000 // 1 second timeout
    );

    expiredBatches.forEach(batch => {
      this.processBatch(batch);
    });
  }

  /**
   * Process a single batch
   */
  private async processBatch(batch: QueryBatch): Promise<void> {
    // Remove from queue
    const index = this.batchQueue.indexOf(batch);
    if (index !== -1) {
      this.batchQueue.splice(index, 1);
    }

    try {
      const vectors = batch.items.map(item => item.vector);
      const results = await this.processBatchChunk(vectors, batch.options);

      // Resolve individual promises
      batch.items.forEach((item, index) => {
        clearTimeout(item.timeout);
        
        if (results[index]) {
          item.resolve(results[index]);
        } else {
          item.reject(new Error('Batch processing failed'));
        }
      });

    } catch (error) {
      // Reject all items in batch
      batch.items.forEach(item => {
        clearTimeout(item.timeout);
        item.reject(error);
      });
    }
  }

  /**
   * Process batch chunk
   */
  private async processBatchChunk(
    vectors: (number[] | Float32Array)[],
    options: any
  ): Promise<QueryResult[]> {
    // Simulate batch processing - replace with actual Pinecone batch API
    return Promise.all(
      vectors.map(vector => this.executeDirectQuery(vector, options))
    );
  }

  /**
   * Check if queries can be batched together
   */
  private areBatchCompatible(options1: any, options2: any): boolean {
    return (
      options1.topK === options2.topK &&
      options1.namespace === options2.namespace &&
      JSON.stringify(options1.filter || {}) === JSON.stringify(options2.filter || {})
    );
  }

  /**
   * Generate cache key for query
   */
  private generateCacheKey(vector: number[] | Float32Array, options: any): string {
    const vectorHash = this.generateVectorKey(vector);
    const optionsHash = createHash('md5')
      .update(JSON.stringify(options))
      .digest('hex');
    
    return `${vectorHash}_${optionsHash}`;
  }

  /**
   * Generate key for vector
   */
  private generateVectorKey(vector: number[] | Float32Array): string {
    // Create hash of first and last few elements for performance
    const sample = [
      ...Array.from(vector.slice(0, 10)),
      ...Array.from(vector.slice(-10))
    ];
    
    return createHash('md5')
      .update(JSON.stringify(sample))
      .digest('hex');
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheValid(cachedResult: CachedResult): boolean {
    return cachedResult.expiresAt > Date.now();
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(responseTime: number, resultCount: number): void {
    this.metrics.avgQueryTime = (
      (this.metrics.avgQueryTime * (this.metrics.totalQueries - 1)) + responseTime
    ) / this.metrics.totalQueries;

    this.metrics.avgResultsCount = (
      (this.metrics.avgResultsCount * (this.metrics.totalQueries - 1)) + resultCount
    ) / this.metrics.totalQueries;
  }

  /**
   * Calculate batch processing efficiency
   */
  private calculateBatchEfficiency(vectorCount: number, totalTime: number): number {
    const avgIndividualTime = this.metrics.avgQueryTime || 100; // Default 100ms
    const expectedIndividualTime = vectorCount * avgIndividualTime;
    return Math.max(0, (expectedIndividualTime - totalTime) / expectedIndividualTime * 100);
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Generate mock matches for testing
   */
  private generateMockMatches(count: number): VectorMatch[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `match_${i}`,
      score: Math.random() * 0.3 + 0.7, // 0.7-1.0 similarity
      metadata: {
        content: `Mock content ${i}`,
        source: `source_${i}`,
        chunk_index: i
      }
    }));
  }

  /**
   * Get performance metrics
   */
  getMetrics(): QueryMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      queryCache: {
        size: this.queryCache.size,
        maxSize: this.queryCache.max || 0,
        hitRate: this.metrics.totalQueries > 0 
          ? (this.metrics.cacheHits / this.metrics.totalQueries) * 100 
          : 0
      },
      vectorCache: {
        size: this.vectorCache.size,
        maxSize: this.vectorCache.max || 0,
        hitRate: 0 // Vector cache doesn't track hits separately
      }
    };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.queryCache.clear();
    this.vectorCache.clear();
    
    this.emit('cachesCleared');
  }

  /**
   * Optimize cache configuration based on usage patterns
   */
  optimizeCacheSettings(): void {
    const hitRate = this.metrics.totalQueries > 0 
      ? (this.metrics.cacheHits / this.metrics.totalQueries) * 100 
      : 0;

    if (hitRate < 20) {
      // Low hit rate - increase cache size
      this.queryCache.max = Math.min((this.queryCache.max || 0) * 1.5, 50000);
    } else if (hitRate > 80) {
      // High hit rate - can reduce TTL for fresher data
      this.config.cacheTTL = Math.max(this.config.cacheTTL * 0.8, 300000); // Min 5 minutes
    }

    this.emit('cacheOptimized', {
      newMaxSize: this.queryCache.max,
      newTTL: this.config.cacheTTL,
      currentHitRate: hitRate
    });
  }

  /**
   * Cleanup and destroy optimizer
   */
  destroy(): void {
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
      this.batchProcessor = null;
    }

    // Process remaining batches
    this.batchQueue.forEach(batch => {
      batch.items.forEach(item => {
        clearTimeout(item.timeout);
        item.reject(new Error('Vector optimizer destroyed'));
      });
    });

    this.batchQueue = [];
    this.queryCache.clear();
    this.vectorCache.clear();

    this.emit('destroyed');
  }
}

// Type definitions
interface CachedResult {
  results: VectorMatch[];
  timestamp: number;
  queryOptions: any;
  expiresAt: number;
}

interface QueryResult {
  matches: VectorMatch[];
  responseTime: number;
  fromCache?: boolean;
}

interface BatchQueryResult extends QueryResult {
  index: number;
}

interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

interface QueryBatch {
  id: string;
  items: BatchItem[];
  options: any;
  createdAt: number;
}

interface BatchItem {
  vector: number[] | Float32Array;
  options: any;
  resolve: (result: QueryResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

interface CacheStats {
  queryCache: {
    size: number;
    maxSize: number;
    hitRate: number;
  };
  vectorCache: {
    size: number;
    maxSize: number;
    hitRate: number;
  };
}

export {
  VectorOptimizationConfig,
  QueryMetrics,
  QueryResult,
  BatchQueryResult,
  VectorMatch,
  CacheStats
};