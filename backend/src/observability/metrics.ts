import { EventEmitter } from 'events';
import os from 'os';
import { performance } from 'perf_hooks';

// Metrics interfaces
interface MetricsCollection {
  // Research metrics
  researchDuration: number;
  toolInvocations: number;
  tokensUsed: number;
  sourcesFound: number;
  
  // System metrics
  memoryUsage: number;
  activeConnections: number;
  apiLatency: Record<string, number>;
  errorRate: number;
  
  // Business metrics
  userSatisfaction?: number;
  costPerQuery: number;
  completionRate: number;
}

interface SystemMetrics {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
    heapUsed: number;
    heapTotal: number;
  };
  network: {
    activeConnections: number;
    requestsPerSecond: number;
    bytesIn: number;
    bytesOut: number;
  };
  disk: {
    usage: number;
    available: number;
  };
}

interface APIMetrics {
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  timestamp: number;
  userTier?: string;
  errors?: string[];
}

interface BusinessMetrics {
  totalResearchQueries: number;
  successfulQueries: number;
  averageResearchDuration: number;
  uniqueActiveUsers: number;
  totalRevenue: number;
  costPerQuery: number;
  userSatisfactionScore: number;
  peakConcurrentUsers: number;
  retentionRate: number;
}

// Metrics collector class
export class MetricsCollector extends EventEmitter {
  private metrics: Map<string, any> = new Map();
  private timers: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private activeConnections = 0;
  private requestCount = 0;
  private errorCount = 0;
  private lastFlush = Date.now();

  // Research metrics tracking
  private researchMetrics = {
    totalQueries: 0,
    successfulQueries: 0,
    totalDuration: 0,
    totalTokens: 0,
    totalCost: 0,
    totalSources: 0,
    averageSatisfaction: 0,
    satisfactionCount: 0,
  };

  // API latency tracking
  private apiLatencies: Map<string, number[]> = new Map();
  
  // User activity tracking
  private activeUsers: Set<string> = new Set();
  private userSessions: Map<string, { startTime: number; lastActivity: number }> = new Map();

  constructor() {
    super();
    this.startSystemMetricsCollection();
    this.setupPeriodicReporting();
  }

  // Start research query tracking
  startResearchQuery(sessionId: string, metadata: {
    userId?: string;
    userTier: string;
    query: string;
  }): void {
    const startTime = performance.now();
    this.timers.set(`research_${sessionId}`, startTime);
    
    this.researchMetrics.totalQueries++;
    this.increment('research.queries.total');
    this.increment(`research.queries.tier.${metadata.userTier}`);
    
    if (metadata.userId) {
      this.activeUsers.add(metadata.userId);
      this.userSessions.set(metadata.userId, {
        startTime: Date.now(),
        lastActivity: Date.now(),
      });
    }

    this.emit('research_started', {
      sessionId,
      timestamp: Date.now(),
      metadata,
    });
  }

  // Complete research query tracking
  completeResearchQuery(sessionId: string, result: {
    success: boolean;
    sourcesFound: number;
    tokensUsed: number;
    cost: number;
    error?: string;
    toolInvocations: number;
  }): void {
    const startTime = this.timers.get(`research_${sessionId}`);
    if (!startTime) return;

    const duration = performance.now() - startTime;
    this.timers.delete(`research_${sessionId}`);

    // Update research metrics
    if (result.success) {
      this.researchMetrics.successfulQueries++;
      this.increment('research.queries.successful');
    } else {
      this.increment('research.queries.failed');
      this.increment(`research.errors.${result.error || 'unknown'}`);
    }

    this.researchMetrics.totalDuration += duration;
    this.researchMetrics.totalTokens += result.tokensUsed;
    this.researchMetrics.totalCost += result.cost;
    this.researchMetrics.totalSources += result.sourcesFound;

    // Record metrics
    this.recordHistogram('research.duration', duration);
    this.recordHistogram('research.tokens_used', result.tokensUsed);
    this.recordHistogram('research.sources_found', result.sourcesFound);
    this.recordHistogram('research.tool_invocations', result.toolInvocations);
    this.recordHistogram('research.cost', result.cost);

    this.emit('research_completed', {
      sessionId,
      duration,
      success: result.success,
      timestamp: Date.now(),
      metrics: result,
    });
  }

  // Track API request metrics
  trackAPIRequest(endpoint: string, method: string, duration: number, statusCode: number, metadata?: {
    userTier?: string;
    userId?: string;
    error?: string;
  }): void {
    this.requestCount++;
    
    if (statusCode >= 400) {
      this.errorCount++;
      this.increment('api.errors.total');
      this.increment(`api.errors.${statusCode}`);
    }

    // Track latency by endpoint
    const key = `${method}_${endpoint}`;
    if (!this.apiLatencies.has(key)) {
      this.apiLatencies.set(key, []);
    }
    this.apiLatencies.get(key)!.push(duration);

    // Keep only last 1000 latency measurements
    const latencies = this.apiLatencies.get(key)!;
    if (latencies.length > 1000) {
      latencies.splice(0, latencies.length - 1000);
    }

    this.recordHistogram('api.request_duration', duration);
    this.recordHistogram(`api.${key}.duration`, duration);
    
    if (metadata?.userTier) {
      this.recordHistogram(`api.duration.tier.${metadata.userTier}`, duration);
    }

    this.emit('api_request', {
      endpoint,
      method,
      duration,
      statusCode,
      timestamp: Date.now(),
      metadata,
    });
  }

  // Track user satisfaction
  recordUserSatisfaction(userId: string, score: number, sessionId?: string): void {
    if (score < 1 || score > 5) return; // Validate score range

    this.researchMetrics.averageSatisfaction = 
      (this.researchMetrics.averageSatisfaction * this.researchMetrics.satisfactionCount + score) /
      (this.researchMetrics.satisfactionCount + 1);
    
    this.researchMetrics.satisfactionCount++;
    
    this.recordHistogram('user.satisfaction', score);
    
    this.emit('user_feedback', {
      userId,
      score,
      sessionId,
      timestamp: Date.now(),
    });
  }

  // Connection tracking
  incrementConnections(): void {
    this.activeConnections++;
    this.recordHistogram('connections.active', this.activeConnections);
  }

  decrementConnections(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.recordHistogram('connections.active', this.activeConnections);
  }

  // Generic counter operations
  increment(key: string, value: number = 1): void {
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  decrement(key: string, value: number = 1): void {
    this.counters.set(key, Math.max(0, (this.counters.get(key) || 0) - value));
  }

  // Record histogram values
  recordHistogram(key: string, value: number): void {
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key)!.push(value);

    // Keep only last 10000 values
    const values = this.histograms.get(key)!;
    if (values.length > 10000) {
      values.splice(0, values.length - 10000);
    }
  }

  // Get current metrics snapshot
  getMetricsSnapshot(): MetricsCollection {
    const systemMetrics = this.getSystemMetrics();
    const apiLatency: Record<string, number> = {};
    
    // Calculate average latencies
    for (const [endpoint, latencies] of this.apiLatencies.entries()) {
      if (latencies.length > 0) {
        apiLatency[endpoint] = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      }
    }

    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
    const completionRate = this.researchMetrics.totalQueries > 0 
      ? this.researchMetrics.successfulQueries / this.researchMetrics.totalQueries 
      : 0;

    return {
      researchDuration: this.researchMetrics.totalDuration / Math.max(1, this.researchMetrics.totalQueries),
      toolInvocations: this.getHistogramAverage('research.tool_invocations'),
      tokensUsed: this.researchMetrics.totalTokens,
      sourcesFound: this.getHistogramAverage('research.sources_found'),
      memoryUsage: systemMetrics.memory.percentage,
      activeConnections: this.activeConnections,
      apiLatency,
      errorRate,
      costPerQuery: this.researchMetrics.totalCost / Math.max(1, this.researchMetrics.totalQueries),
      completionRate,
    };
  }

  // Get system metrics
  getSystemMetrics(): SystemMetrics {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const loadAverage = os.loadavg();

    return {
      cpu: {
        usage: this.getCPUUsage(),
        loadAverage,
      },
      memory: {
        used: totalMemory - freeMemory,
        total: totalMemory,
        percentage: ((totalMemory - freeMemory) / totalMemory) * 100,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
      },
      network: {
        activeConnections: this.activeConnections,
        requestsPerSecond: this.getRequestsPerSecond(),
        bytesIn: 0, // Would be tracked by middleware
        bytesOut: 0, // Would be tracked by middleware
      },
      disk: {
        usage: 0, // Would need additional monitoring
        available: 0, // Would need additional monitoring
      },
    };
  }

  // Get business metrics
  getBusinessMetrics(): BusinessMetrics {
    const now = Date.now();
    const activeUserCount = Array.from(this.userSessions.entries())
      .filter(([_, session]) => now - session.lastActivity < 30 * 60 * 1000) // Active in last 30 minutes
      .length;

    return {
      totalResearchQueries: this.researchMetrics.totalQueries,
      successfulQueries: this.researchMetrics.successfulQueries,
      averageResearchDuration: this.researchMetrics.totalDuration / Math.max(1, this.researchMetrics.totalQueries),
      uniqueActiveUsers: activeUserCount,
      totalRevenue: this.calculateRevenue(),
      costPerQuery: this.researchMetrics.totalCost / Math.max(1, this.researchMetrics.totalQueries),
      userSatisfactionScore: this.researchMetrics.averageSatisfaction,
      peakConcurrentUsers: this.getHistogramMax('connections.active'),
      retentionRate: this.calculateRetentionRate(),
    };
  }

  // Get detailed analytics
  getAnalytics(timeRange: { start: number; end: number }) {
    return {
      overview: this.getMetricsSnapshot(),
      system: this.getSystemMetrics(),
      business: this.getBusinessMetrics(),
      api: this.getAPIAnalytics(),
      research: this.getResearchAnalytics(),
      users: this.getUserAnalytics(),
      performance: this.getPerformanceAnalytics(),
    };
  }

  // Private helper methods
  private getHistogramAverage(key: string): number {
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private getHistogramMax(key: string): number {
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return 0;
    return Math.max(...values);
  }

  private getHistogramPercentile(key: string, percentile: number): number {
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private getCPUUsage(): number {
    // Simple CPU usage approximation
    // In production, use more sophisticated CPU monitoring
    const loadAvg = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    return Math.min(100, (loadAvg / cpuCount) * 100);
  }

  private getRequestsPerSecond(): number {
    const timeSinceLastFlush = Date.now() - this.lastFlush;
    if (timeSinceLastFlush < 1000) return 0;
    
    const rps = (this.requestCount * 1000) / timeSinceLastFlush;
    return rps;
  }

  private calculateRevenue(): number {
    // Simplified revenue calculation based on queries and user tiers
    return this.researchMetrics.successfulQueries * 0.10; // $0.10 per successful query
  }

  private calculateRetentionRate(): number {
    // Simplified retention calculation
    const totalUsers = this.userSessions.size;
    if (totalUsers === 0) return 0;
    
    const now = Date.now();
    const activeUsers = Array.from(this.userSessions.values())
      .filter(session => now - session.startTime < 7 * 24 * 60 * 60 * 1000) // Active in last 7 days
      .length;
    
    return (activeUsers / totalUsers) * 100;
  }

  private getAPIAnalytics() {
    const analytics: Record<string, any> = {};
    
    for (const [endpoint, latencies] of this.apiLatencies.entries()) {
      if (latencies.length > 0) {
        analytics[endpoint] = {
          count: latencies.length,
          average: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
          min: Math.min(...latencies),
          max: Math.max(...latencies),
          p50: this.getPercentile(latencies, 50),
          p95: this.getPercentile(latencies, 95),
          p99: this.getPercentile(latencies, 99),
        };
      }
    }
    
    return analytics;
  }

  private getResearchAnalytics() {
    return {
      totalQueries: this.researchMetrics.totalQueries,
      successRate: this.researchMetrics.totalQueries > 0 
        ? (this.researchMetrics.successfulQueries / this.researchMetrics.totalQueries) * 100 
        : 0,
      averageDuration: this.getHistogramAverage('research.duration'),
      averageTokens: this.getHistogramAverage('research.tokens_used'),
      averageSources: this.getHistogramAverage('research.sources_found'),
      averageCost: this.getHistogramAverage('research.cost'),
      durationPercentiles: {
        p50: this.getHistogramPercentile('research.duration', 50),
        p95: this.getHistogramPercentile('research.duration', 95),
        p99: this.getHistogramPercentile('research.duration', 99),
      },
    };
  }

  private getUserAnalytics() {
    const now = Date.now();
    const activeUsers = Array.from(this.userSessions.entries())
      .filter(([_, session]) => now - session.lastActivity < 30 * 60 * 1000);

    return {
      totalUsers: this.userSessions.size,
      activeUsers: activeUsers.length,
      averageSessionDuration: this.calculateAverageSessionDuration(),
      userSatisfaction: this.researchMetrics.averageSatisfaction,
      satisfactionSamples: this.researchMetrics.satisfactionCount,
    };
  }

  private getPerformanceAnalytics() {
    return {
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
      requestsPerSecond: this.getRequestsPerSecond(),
      averageResponseTime: this.getHistogramAverage('api.request_duration'),
      memoryUsage: process.memoryUsage(),
      activeConnections: this.activeConnections,
    };
  }

  private getPercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateAverageSessionDuration(): number {
    const sessions = Array.from(this.userSessions.values());
    if (sessions.length === 0) return 0;
    
    const totalDuration = sessions.reduce((sum, session) => 
      sum + (session.lastActivity - session.startTime), 0);
    
    return totalDuration / sessions.length;
  }

  // System metrics collection
  private startSystemMetricsCollection(): void {
    setInterval(() => {
      const metrics = this.getSystemMetrics();
      
      this.recordHistogram('system.memory.percentage', metrics.memory.percentage);
      this.recordHistogram('system.cpu.usage', metrics.cpu.usage);
      this.recordHistogram('system.memory.heap_used', metrics.memory.heapUsed);
      
      this.emit('system_metrics', metrics);
    }, 30000); // Every 30 seconds
  }

  // Periodic reporting
  private setupPeriodicReporting(): void {
    setInterval(() => {
      this.emit('metrics_report', this.getMetricsSnapshot());
      
      // Reset counters for next period
      this.requestCount = 0;
      this.errorCount = 0;
      this.lastFlush = Date.now();
    }, 60000); // Every minute
  }

  // Clean up old data
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up old user sessions
    for (const [userId, session] of this.userSessions.entries()) {
      if (now - session.lastActivity > maxAge) {
        this.userSessions.delete(userId);
        this.activeUsers.delete(userId);
      }
    }
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector();

// Middleware for automatic request tracking
export const metricsMiddleware = (req: any, res: any, next: any) => {
  const startTime = performance.now();
  
  metricsCollector.incrementConnections();
  
  res.on('finish', () => {
    const duration = performance.now() - startTime;
    metricsCollector.decrementConnections();
    
    metricsCollector.trackAPIRequest(
      req.route?.path || req.path,
      req.method,
      duration,
      res.statusCode,
      {
        userTier: req.user?.tier,
        userId: req.user?.id,
        error: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : undefined,
      }
    );
  });
  
  next();
};

// Cleanup old data every hour
setInterval(() => {
  (metricsCollector as any).cleanup();
}, 60 * 60 * 1000);

export { MetricsCollection, SystemMetrics, APIMetrics, BusinessMetrics };