/**
 * Advanced Connection Pool Manager for AI Research Agent
 * 
 * Implements connection pooling, request queuing, and caching strategies
 * to optimize backend performance under high load conditions.
 */

import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache';
import pLimit from 'p-limit';

export interface ConnectionConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  connectionTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface QueueConfig {
  maxSize: number;
  timeout: number;
  priority: boolean;
  fifo: boolean;
}

export interface CacheConfig {
  maxSize: number;
  ttl: number;
  updateAgeOnGet: boolean;
  allowStale: boolean;
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, Connection> = new Map();
  private availableConnections: Set<string> = new Set();
  private busyConnections: Set<string> = new Set();
  private waitingQueue: QueueItem[] = [];
  private config: ConnectionConfig;
  private stats: PoolStats;

  constructor(config: Partial<ConnectionConfig> = {}) {
    super();
    
    this.config = {
      maxConnections: 100,
      minConnections: 10,
      acquireTimeout: 30000,
      idleTimeout: 300000, // 5 minutes
      connectionTimeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };

    this.stats = {
      totalConnections: 0,
      availableConnections: 0,
      busyConnections: 0,
      queuedRequests: 0,
      totalAcquired: 0,
      totalReleased: 0,
      timeouts: 0,
      errors: 0,
      avgAcquireTime: 0,
      peakConnections: 0
    };

    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Create minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      await this.createConnection();
    }

    // Start maintenance tasks
    this.startMaintenanceTasks();
    
    this.emit('initialized', {
      minConnections: this.config.minConnections,
      maxConnections: this.config.maxConnections
    });
  }

  async acquireConnection(priority: number = 0): Promise<Connection> {
    const startTime = performance.now();

    return new Promise((resolve, reject) => {
      const queueItem: QueueItem = {
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
        timeout: setTimeout(() => {
          this.removeFromQueue(queueItem);
          this.stats.timeouts++;
          reject(new Error('Connection acquire timeout'));
        }, this.config.acquireTimeout)
      };

      // Try to get available connection immediately
      const connection = this.getAvailableConnection();
      if (connection) {
        clearTimeout(queueItem.timeout);
        this.markConnectionBusy(connection);
        this.stats.totalAcquired++;
        this.stats.avgAcquireTime = this.updateAverage(
          this.stats.avgAcquireTime,
          performance.now() - startTime,
          this.stats.totalAcquired
        );
        resolve(connection);
        return;
      }

      // Try to create new connection if under limit
      if (this.connections.size < this.config.maxConnections) {
        this.createConnection()
          .then(newConnection => {
            clearTimeout(queueItem.timeout);
            this.markConnectionBusy(newConnection);
            this.stats.totalAcquired++;
            this.stats.avgAcquireTime = this.updateAverage(
              this.stats.avgAcquireTime,
              performance.now() - startTime,
              this.stats.totalAcquired
            );
            resolve(newConnection);
          })
          .catch(error => {
            clearTimeout(queueItem.timeout);
            this.stats.errors++;
            reject(error);
          });
        return;
      }

      // Add to queue
      this.addToQueue(queueItem);
      this.stats.queuedRequests++;
    });
  }

  releaseConnection(connection: Connection): void {
    if (!this.connections.has(connection.id)) {
      this.emit('warning', `Attempted to release unknown connection: ${connection.id}`);
      return;
    }

    this.markConnectionAvailable(connection);
    this.stats.totalReleased++;

    // Update connection last used time
    connection.lastUsed = Date.now();

    // Process waiting queue
    this.processQueue();

    this.emit('connectionReleased', {
      connectionId: connection.id,
      availableConnections: this.availableConnections.size,
      queueLength: this.waitingQueue.length
    });
  }

  private async createConnection(): Promise<Connection> {
    const connection: Connection = {
      id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created: Date.now(),
      lastUsed: Date.now(),
      isHealthy: true,
      metadata: {}
    };

    try {
      // Simulate connection creation (replace with actual implementation)
      await this.establishConnection(connection);
      
      this.connections.set(connection.id, connection);
      this.availableConnections.add(connection.id);
      
      this.stats.totalConnections++;
      this.stats.availableConnections++;
      this.stats.peakConnections = Math.max(this.stats.peakConnections, this.connections.size);

      this.emit('connectionCreated', {
        connectionId: connection.id,
        totalConnections: this.connections.size
      });

      return connection;

    } catch (error) {
      this.stats.errors++;
      throw new Error(`Failed to create connection: ${error.message}`);
    }
  }

  private async establishConnection(connection: Connection): Promise<void> {
    // Simulate connection establishment
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() > 0.95) { // 5% failure rate for testing
          reject(new Error('Connection establishment failed'));
        } else {
          resolve();
        }
      }, Math.random() * 100); // 0-100ms connection time
    });
  }

  private getAvailableConnection(): Connection | null {
    const connectionId = this.availableConnections.values().next().value;
    if (!connectionId) return null;

    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isHealthy) {
      this.availableConnections.delete(connectionId);
      return this.getAvailableConnection();
    }

    return connection;
  }

  private markConnectionBusy(connection: Connection): void {
    this.availableConnections.delete(connection.id);
    this.busyConnections.add(connection.id);
    this.stats.availableConnections--;
    this.stats.busyConnections++;
  }

  private markConnectionAvailable(connection: Connection): void {
    this.busyConnections.delete(connection.id);
    this.availableConnections.add(connection.id);
    this.stats.busyConnections--;
    this.stats.availableConnections++;
  }

  private addToQueue(queueItem: QueueItem): void {
    if (this.waitingQueue.length >= 1000) { // Max queue size
      clearTimeout(queueItem.timeout);
      queueItem.reject(new Error('Queue is full'));
      return;
    }

    // Insert based on priority
    const insertIndex = this.waitingQueue.findIndex(
      item => item.priority < queueItem.priority
    );
    
    if (insertIndex === -1) {
      this.waitingQueue.push(queueItem);
    } else {
      this.waitingQueue.splice(insertIndex, 0, queueItem);
    }
  }

  private removeFromQueue(queueItem: QueueItem): void {
    const index = this.waitingQueue.indexOf(queueItem);
    if (index !== -1) {
      this.waitingQueue.splice(index, 1);
      this.stats.queuedRequests--;
    }
  }

  private processQueue(): void {
    if (this.waitingQueue.length === 0) return;

    const queueItem = this.waitingQueue.shift();
    if (!queueItem) return;

    this.stats.queuedRequests--;
    clearTimeout(queueItem.timeout);

    const connection = this.getAvailableConnection();
    if (connection) {
      this.markConnectionBusy(connection);
      this.stats.totalAcquired++;
      queueItem.resolve(connection);
    } else {
      // Re-queue if no connection available
      this.addToQueue(queueItem);
    }
  }

  private startMaintenanceTasks(): void {
    // Idle connection cleanup
    setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // Every minute

    // Health checks
    setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Every 30 seconds

    // Stats reporting
    setInterval(() => {
      this.emit('stats', this.getStats());
    }, 10000); // Every 10 seconds
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleThreshold = now - this.config.idleTimeout;

    for (const [connectionId, connection] of this.connections.entries()) {
      if (
        connection.lastUsed < idleThreshold &&
        this.availableConnections.has(connectionId) &&
        this.connections.size > this.config.minConnections
      ) {
        this.destroyConnection(connectionId);
      }
    }
  }

  private async performHealthChecks(): Promise<void> {
    const unhealthyConnections: string[] = [];

    for (const [connectionId, connection] of this.connections.entries()) {
      if (!await this.isConnectionHealthy(connection)) {
        unhealthyConnections.push(connectionId);
      }
    }

    // Remove unhealthy connections
    unhealthyConnections.forEach(connectionId => {
      this.destroyConnection(connectionId);
    });
  }

  private async isConnectionHealthy(connection: Connection): Promise<boolean> {
    try {
      // Simulate health check
      return Math.random() > 0.02; // 2% failure rate
    } catch {
      return false;
    }
  }

  private destroyConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.connections.delete(connectionId);
    this.availableConnections.delete(connectionId);
    this.busyConnections.delete(connectionId);

    this.stats.totalConnections--;
    if (this.availableConnections.has(connectionId)) {
      this.stats.availableConnections--;
    } else {
      this.stats.busyConnections--;
    }

    this.emit('connectionDestroyed', {
      connectionId,
      reason: 'idle_timeout',
      totalConnections: this.connections.size
    });
  }

  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }

  getStats(): PoolStats {
    return {
      ...this.stats,
      availableConnections: this.availableConnections.size,
      busyConnections: this.busyConnections.size,
      queuedRequests: this.waitingQueue.length,
      totalConnections: this.connections.size
    };
  }

  async destroy(): Promise<void> {
    // Clear all waiting requests
    this.waitingQueue.forEach(item => {
      clearTimeout(item.timeout);
      item.reject(new Error('Connection pool destroyed'));
    });
    this.waitingQueue = [];

    // Destroy all connections
    for (const connectionId of this.connections.keys()) {
      this.destroyConnection(connectionId);
    }

    this.emit('destroyed');
  }
}

export class RequestQueue extends EventEmitter {
  private queue: QueuedRequest[] = [];
  private processing = false;
  private config: QueueConfig;
  private stats: QueueStats;
  private limiter: any;

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    
    this.config = {
      maxSize: 10000,
      timeout: 30000,
      priority: true,
      fifo: true,
      ...config
    };

    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      avgProcessingTime: 0,
      currentQueueSize: 0,
      peakQueueSize: 0
    };

    // Create rate limiter
    this.limiter = pLimit(50); // Max 50 concurrent requests
  }

  async enqueue<T>(
    task: () => Promise<T>,
    options: {
      priority?: number;
      timeout?: number;
      retries?: number;
      metadata?: any;
    } = {}
  ): Promise<T> {
    const request: QueuedRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      task,
      priority: options.priority || 0,
      timeout: options.timeout || this.config.timeout,
      retries: options.retries || 0,
      metadata: options.metadata || {},
      enqueuedAt: Date.now(),
      attempts: 0
    };

    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.config.maxSize) {
        reject(new Error('Queue is full'));
        return;
      }

      request.resolve = resolve;
      request.reject = reject;

      // Set timeout
      request.timeoutHandle = setTimeout(() => {
        this.removeFromQueue(request.id);
        reject(new Error('Request timeout'));
      }, request.timeout);

      // Add to queue with priority sorting
      this.addToQueue(request);
      this.stats.totalQueued++;
      this.stats.currentQueueSize = this.queue.length;
      this.stats.peakQueueSize = Math.max(this.stats.peakQueueSize, this.queue.length);

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }

      this.emit('requestQueued', {
        requestId: request.id,
        queueSize: this.queue.length,
        priority: request.priority
      });
    });
  }

  private addToQueue(request: QueuedRequest): void {
    if (!this.config.priority) {
      this.queue.push(request);
      return;
    }

    // Insert based on priority (higher priority first)
    const insertIndex = this.queue.findIndex(
      item => item.priority < request.priority
    );
    
    if (insertIndex === -1) {
      this.queue.push(request);
    } else {
      this.queue.splice(insertIndex, 0, request);
    }
  }

  private removeFromQueue(requestId: string): QueuedRequest | null {
    const index = this.queue.findIndex(req => req.id === requestId);
    if (index === -1) return null;

    const request = this.queue[index];
    this.queue.splice(index, 1);
    this.stats.currentQueueSize = this.queue.length;

    if (request.timeoutHandle) {
      clearTimeout(request.timeoutHandle);
    }

    return request;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) break;

      this.stats.currentQueueSize = this.queue.length;

      try {
        await this.processRequest(request);
      } catch (error) {
        console.error('Queue processing error:', error);
      }
    }

    this.processing = false;
  }

  private async processRequest(request: QueuedRequest): Promise<void> {
    const startTime = performance.now();
    request.attempts++;

    try {
      // Use rate limiter to control concurrency
      const result = await this.limiter(() => request.task());
      
      const processingTime = performance.now() - startTime;
      this.stats.totalProcessed++;
      this.stats.avgProcessingTime = this.updateAverage(
        this.stats.avgProcessingTime,
        processingTime,
        this.stats.totalProcessed
      );

      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }

      request.resolve?.(result);

      this.emit('requestCompleted', {
        requestId: request.id,
        processingTime,
        attempts: request.attempts
      });

    } catch (error) {
      // Retry logic
      if (request.attempts < request.retries + 1) {
        // Re-queue with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, request.attempts - 1), 30000);
        
        setTimeout(() => {
          this.addToQueue(request);
        }, delay);

        this.emit('requestRetrying', {
          requestId: request.id,
          attempt: request.attempts,
          delay
        });

        return;
      }

      // Max retries exceeded
      this.stats.totalFailed++;

      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }

      request.reject?.(error);

      this.emit('requestFailed', {
        requestId: request.id,
        error: error.message,
        attempts: request.attempts
      });
    }
  }

  private updateAverage(currentAvg: number, newValue: number, count: number): number {
    return ((currentAvg * (count - 1)) + newValue) / count;
  }

  getStats(): QueueStats {
    return {
      ...this.stats,
      currentQueueSize: this.queue.length
    };
  }

  async drain(): Promise<void> {
    return new Promise((resolve) => {
      if (this.queue.length === 0 && !this.processing) {
        resolve();
        return;
      }

      const checkEmpty = () => {
        if (this.queue.length === 0 && !this.processing) {
          resolve();
        } else {
          setTimeout(checkEmpty, 100);
        }
      };

      checkEmpty();
    });
  }

  clear(): void {
    this.queue.forEach(request => {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.reject?.(new Error('Queue cleared'));
    });

    this.queue = [];
    this.stats.currentQueueSize = 0;
    this.emit('queueCleared');
  }
}

export class MultiLevelCache extends EventEmitter {
  private l1Cache: LRUCache<string, any>; // Memory cache
  private l2Cache: Map<string, CacheEntry> = new Map(); // Persistent cache
  private config: CacheConfig;
  private stats: CacheStats;

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    
    this.config = {
      maxSize: 10000,
      ttl: 300000, // 5 minutes
      updateAgeOnGet: true,
      allowStale: false,
      ...config
    };

    this.l1Cache = new LRUCache({
      max: this.config.maxSize,
      ttl: this.config.ttl,
      updateAgeOnGet: this.config.updateAgeOnGet,
      allowStale: this.config.allowStale
    });

    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      totalGets: 0,
      totalSets: 0,
      evictions: 0,
      hitRate: 0
    };

    this.startMaintenanceTasks();
  }

  async get<T>(key: string): Promise<T | null> {
    this.stats.totalGets++;

    // Try L1 cache first
    const l1Result = this.l1Cache.get(key);
    if (l1Result !== undefined) {
      this.stats.l1Hits++;
      this.updateHitRate();
      this.emit('cacheHit', { level: 'L1', key });
      return l1Result;
    }
    this.stats.l1Misses++;

    // Try L2 cache
    const l2Entry = this.l2Cache.get(key);
    if (l2Entry && this.isValidEntry(l2Entry)) {
      this.stats.l2Hits++;
      this.updateHitRate();
      
      // Promote to L1
      this.l1Cache.set(key, l2Entry.value);
      
      this.emit('cacheHit', { level: 'L2', key });
      return l2Entry.value;
    }
    
    if (l2Entry) {
      // Remove expired entry
      this.l2Cache.delete(key);
    }
    
    this.stats.l2Misses++;
    this.updateHitRate();
    this.emit('cacheMiss', { key });
    
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.stats.totalSets++;

    const effectiveTtl = ttl || this.config.ttl;
    const expiresAt = Date.now() + effectiveTtl;

    // Set in L1 cache
    this.l1Cache.set(key, value, { ttl: effectiveTtl });

    // Set in L2 cache
    this.l2Cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      accessCount: 0
    });

    this.emit('cacheSet', { key, ttl: effectiveTtl });
  }

  async delete(key: string): Promise<boolean> {
    const l1Deleted = this.l1Cache.delete(key);
    const l2Deleted = this.l2Cache.delete(key);

    if (l1Deleted || l2Deleted) {
      this.emit('cacheDelete', { key });
      return true;
    }

    return false;
  }

  async clear(): Promise<void> {
    this.l1Cache.clear();
    this.l2Cache.clear();
    this.resetStats();
    this.emit('cacheCleared');
  }

  async has(key: string): Promise<boolean> {
    return this.l1Cache.has(key) || 
           (this.l2Cache.has(key) && this.isValidEntry(this.l2Cache.get(key)!));
  }

  async keys(): Promise<string[]> {
    const l1Keys = Array.from(this.l1Cache.keys());
    const l2Keys = Array.from(this.l2Cache.keys()).filter(key => 
      !l1Keys.includes(key) && this.isValidEntry(this.l2Cache.get(key)!)
    );
    
    return [...l1Keys, ...l2Keys];
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      l1Size: this.l1Cache.size,
      l2Size: this.l2Cache.size,
      totalSize: this.l1Cache.size + this.l2Cache.size
    };
  }

  private isValidEntry(entry: CacheEntry): boolean {
    return entry.expiresAt > Date.now();
  }

  private updateHitRate(): void {
    const totalRequests = this.stats.l1Hits + this.stats.l1Misses;
    const totalHits = this.stats.l1Hits + this.stats.l2Hits;
    this.stats.hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
  }

  private resetStats(): void {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      totalGets: 0,
      totalSets: 0,
      evictions: 0,
      hitRate: 0
    };
  }

  private startMaintenanceTasks(): void {
    // L2 cache cleanup
    setInterval(() => {
      this.cleanupL2Cache();
    }, 60000); // Every minute

    // Stats reporting
    setInterval(() => {
      this.emit('cacheStats', this.getStats());
    }, 30000); // Every 30 seconds
  }

  private cleanupL2Cache(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.l2Cache.entries()) {
      if (entry.expiresAt <= now) {
        this.l2Cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.stats.evictions += evicted;
      this.emit('cacheEviction', { count: evicted, level: 'L2' });
    }
  }
}

// Type definitions
interface Connection {
  id: string;
  created: number;
  lastUsed: number;
  isHealthy: boolean;
  metadata: Record<string, any>;
}

interface QueueItem {
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

interface QueuedRequest {
  id: string;
  task: () => Promise<any>;
  priority: number;
  timeout: number;
  retries: number;
  metadata: any;
  enqueuedAt: number;
  attempts: number;
  resolve?: (result: any) => void;
  reject?: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

interface CacheEntry {
  value: any;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
}

interface PoolStats {
  totalConnections: number;
  availableConnections: number;
  busyConnections: number;
  queuedRequests: number;
  totalAcquired: number;
  totalReleased: number;
  timeouts: number;
  errors: number;
  avgAcquireTime: number;
  peakConnections: number;
}

interface QueueStats {
  totalQueued: number;
  totalProcessed: number;
  totalFailed: number;
  avgProcessingTime: number;
  currentQueueSize: number;
  peakQueueSize: number;
}

interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  totalGets: number;
  totalSets: number;
  evictions: number;
  hitRate: number;
  l1Size?: number;
  l2Size?: number;
  totalSize?: number;
}

export { ConnectionConfig, QueueConfig, CacheConfig, PoolStats, QueueStats, CacheStats };