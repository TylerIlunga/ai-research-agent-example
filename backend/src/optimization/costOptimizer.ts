/**
 * API Cost Optimization Engine for AI Research Agent
 * 
 * Implements intelligent strategies to minimize API costs while maintaining
 * performance and quality through model selection, caching, and usage optimization.
 */

import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache';

export interface CostOptimizationConfig {
  dailyBudgetLimit: number;
  monthlyBudgetLimit: number;
  emergencyThreshold: number;
  openaiModels: ModelConfig[];
  tavilyConfig: TavilyConfig;
  pineconeConfig: PineconeConfig;
  enableSmartCaching: boolean;
  enableModelFallback: boolean;
  enableUsageQuotas: boolean;
  enableCostPrediction: boolean;
}

export interface ModelConfig {
  name: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  maxTokens: number;
  qualityScore: number;
  speedScore: number;
  useCase: string[];
}

export interface TavilyConfig {
  costPerSearch: number;
  cacheHours: number;
  batchSize: number;
  maxSearchesPerQuery: number;
}

export interface PineconeConfig {
  costPerQuery: number;
  costPerUpsert: number;
  cacheHours: number;
  maxQueriesPerSession: number;
}

export interface CostMetrics {
  dailySpend: number;
  monthlySpend: number;
  projectedMonthlySpend: number;
  costPerQuery: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  savings: CostSavings;
  quotaUsage: QuotaUsage;
}

export interface CostSavings {
  cachingSavings: number;
  modelOptimizationSavings: number;
  batchingSavings: number;
  totalSavings: number;
  savingsPercentage: number;
}

export interface QuotaUsage {
  daily: { used: number; limit: number; percentage: number };
  monthly: { used: number; limit: number; percentage: number };
  byTier: Record<string, { used: number; limit: number; percentage: number }>;
}

export class CostOptimizer extends EventEmitter {
  private config: CostOptimizationConfig;
  private responseCache: LRUCache<string, CachedResponse>;
  private searchCache: LRUCache<string, CachedSearchResult>;
  private vectorCache: LRUCache<string, CachedVectorResult>;
  private metrics: CostMetrics;
  private userQuotas: Map<string, UserQuota> = new Map();
  private costTracker: CostTracker;

  constructor(config: Partial<CostOptimizationConfig> = {}) {
    super();
    
    this.config = {
      dailyBudgetLimit: 1000, // $1000/day
      monthlyBudgetLimit: 25000, // $25000/month
      emergencyThreshold: 0.9, // 90% of budget
      openaiModels: this.getDefaultModelConfigs(),
      tavilyConfig: {
        costPerSearch: 0.02,
        cacheHours: 6,
        batchSize: 5,
        maxSearchesPerQuery: 10
      },
      pineconeConfig: {
        costPerQuery: 0.001,
        costPerUpsert: 0.0001,
        cacheHours: 24,
        maxQueriesPerSession: 100
      },
      enableSmartCaching: true,
      enableModelFallback: true,
      enableUsageQuotas: true,
      enableCostPrediction: true,
      ...config
    };

    this.initializeCaches();
    this.initializeMetrics();
    this.costTracker = new CostTracker();
    this.startBackgroundTasks();
  }

  /**
   * Optimize OpenAI API calls with smart model selection and caching
   */
  async optimizeOpenAICall(
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      useCase?: string;
      userId?: string;
      priority?: number;
    } = {}
  ): Promise<OptimizedLLMResponse> {
    const startTime = performance.now();
    
    try {
      // Check user quota
      if (this.config.enableUsageQuotas && options.userId) {
        await this.checkUserQuota(options.userId, 'openai');
      }

      // Generate cache key
      const cacheKey = this.generateLLMCacheKey(prompt, options);
      
      // Check cache first
      if (this.config.enableSmartCaching) {
        const cachedResponse = this.responseCache.get(cacheKey);
        if (cachedResponse && this.isCacheValid(cachedResponse)) {
          this.trackCostSaving('caching', cachedResponse.originalCost);
          
          return {
            response: cachedResponse.response,
            model: cachedResponse.model,
            cost: 0,
            tokensUsed: cachedResponse.tokensUsed,
            fromCache: true,
            responseTime: performance.now() - startTime
          };
        }
      }

      // Select optimal model
      const selectedModel = this.selectOptimalModel(prompt, options);
      
      // Execute API call
      const result = await this.executeOpenAICall(prompt, selectedModel, options);
      
      // Calculate cost
      const cost = this.calculateOpenAICost(result.tokensUsed, selectedModel);
      
      // Cache response
      if (this.config.enableSmartCaching && this.shouldCache(result.response)) {
        this.responseCache.set(cacheKey, {
          response: result.response,
          model: selectedModel.name,
          tokensUsed: result.tokensUsed,
          originalCost: cost,
          timestamp: Date.now(),
          expiresAt: Date.now() + (6 * 60 * 60 * 1000) // 6 hours
        });
      }

      // Track usage and cost
      this.trackAPIUsage('openai', cost, options.userId);
      
      return {
        response: result.response,
        model: selectedModel.name,
        cost,
        tokensUsed: result.tokensUsed,
        fromCache: false,
        responseTime: performance.now() - startTime
      };

    } catch (error) {
      this.emit('apiError', {
        provider: 'openai',
        error: error.message,
        cost: 0
      });
      throw error;
    }
  }

  /**
   * Optimize Tavily search calls with intelligent caching and batching
   */
  async optimizeTavilySearch(
    queries: string[],
    options: {
      maxResults?: number;
      searchDepth?: string;
      userId?: string;
      priority?: number;
    } = {}
  ): Promise<OptimizedSearchResponse> {
    const startTime = performance.now();
    
    try {
      // Check user quota
      if (this.config.enableUsageQuotas && options.userId) {
        await this.checkUserQuota(options.userId, 'tavily');
      }

      const results: SearchResult[] = [];
      let totalCost = 0;
      let cacheHits = 0;
      let actualSearches = 0;

      // Process queries with caching
      for (const query of queries) {
        const cacheKey = this.generateSearchCacheKey(query, options);
        
        // Check cache
        if (this.config.enableSmartCaching) {
          const cachedResult = this.searchCache.get(cacheKey);
          if (cachedResult && this.isCacheValid(cachedResult)) {
            results.push(...cachedResult.results);
            cacheHits++;
            this.trackCostSaving('caching', this.config.tavilyConfig.costPerSearch);
            continue;
          }
        }

        // Execute search
        const searchResult = await this.executeTavilySearch(query, options);
        results.push(...searchResult.results);
        actualSearches++;
        
        const searchCost = this.config.tavilyConfig.costPerSearch;
        totalCost += searchCost;

        // Cache results
        if (this.config.enableSmartCaching) {
          this.searchCache.set(cacheKey, {
            results: searchResult.results,
            timestamp: Date.now(),
            expiresAt: Date.now() + (this.config.tavilyConfig.cacheHours * 60 * 60 * 1000)
          });
        }
      }

      // Track usage
      this.trackAPIUsage('tavily', totalCost, options.userId);

      return {
        results: this.deduplicateSearchResults(results),
        totalSearches: queries.length,
        cacheHits,
        actualSearches,
        cost: totalCost,
        responseTime: performance.now() - startTime
      };

    } catch (error) {
      this.emit('apiError', {
        provider: 'tavily',
        error: error.message,
        cost: totalCost
      });
      throw error;
    }
  }

  /**
   * Optimize Pinecone vector operations
   */
  async optimizePineconeQuery(
    vector: number[],
    options: {
      topK?: number;
      filter?: Record<string, any>;
      namespace?: string;
      userId?: string;
    } = {}
  ): Promise<OptimizedVectorResponse> {
    const startTime = performance.now();
    
    try {
      // Check user quota
      if (this.config.enableUsageQuotas && options.userId) {
        await this.checkUserQuota(options.userId, 'pinecone');
      }

      const cacheKey = this.generateVectorCacheKey(vector, options);
      
      // Check cache
      if (this.config.enableSmartCaching) {
        const cachedResult = this.vectorCache.get(cacheKey);
        if (cachedResult && this.isCacheValid(cachedResult)) {
          this.trackCostSaving('caching', this.config.pineconeConfig.costPerQuery);
          
          return {
            matches: cachedResult.matches,
            cost: 0,
            fromCache: true,
            responseTime: performance.now() - startTime
          };
        }
      }

      // Execute query
      const result = await this.executePineconeQuery(vector, options);
      const cost = this.config.pineconeConfig.costPerQuery;

      // Cache results
      if (this.config.enableSmartCaching) {
        this.vectorCache.set(cacheKey, {
          matches: result.matches,
          timestamp: Date.now(),
          expiresAt: Date.now() + (this.config.pineconeConfig.cacheHours * 60 * 60 * 1000)
        });
      }

      // Track usage
      this.trackAPIUsage('pinecone', cost, options.userId);

      return {
        matches: result.matches,
        cost,
        fromCache: false,
        responseTime: performance.now() - startTime
      };

    } catch (error) {
      this.emit('apiError', {
        provider: 'pinecone',
        error: error.message,
        cost: 0
      });
      throw error;
    }
  }

  /**
   * Select optimal OpenAI model based on use case and cost
   */
  private selectOptimalModel(prompt: string, options: any): ModelConfig {
    const useCase = options.useCase || 'general';
    const priority = options.priority || 5;
    const maxTokens = options.maxTokens || 4000;
    
    // Filter models by use case and token limit
    const suitableModels = this.config.openaiModels.filter(model => 
      model.useCase.includes(useCase) && model.maxTokens >= maxTokens
    );

    if (suitableModels.length === 0) {
      return this.config.openaiModels[0]; // Fallback to first model
    }

    // Cost-based selection with quality consideration
    if (priority <= 3) {
      // High priority - prioritize quality
      return suitableModels.reduce((best, current) => 
        current.qualityScore > best.qualityScore ? current : best
      );
    } else if (priority >= 8) {
      // Low priority - prioritize cost
      return suitableModels.reduce((best, current) => {
        const currentCostScore = current.inputCostPer1k + current.outputCostPer1k;
        const bestCostScore = best.inputCostPer1k + best.outputCostPer1k;
        return currentCostScore < bestCostScore ? current : best;
      });
    } else {
      // Medium priority - balance cost and quality
      return suitableModels.reduce((best, current) => {
        const currentScore = current.qualityScore / (current.inputCostPer1k + current.outputCostPer1k);
        const bestScore = best.qualityScore / (best.inputCostPer1k + best.outputCostPer1k);
        return currentScore > bestScore ? current : best;
      });
    }
  }

  /**
   * Check if user is within quota limits
   */
  private async checkUserQuota(userId: string, provider: string): Promise<void> {
    const userQuota = this.getUserQuota(userId);
    const now = new Date();
    const today = now.toDateString();
    const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;

    // Reset counters if needed
    if (userQuota.lastResetDay !== today) {
      userQuota.dailyUsage = {};
      userQuota.lastResetDay = today;
    }
    
    if (userQuota.lastResetMonth !== currentMonth) {
      userQuota.monthlyUsage = {};
      userQuota.lastResetMonth = currentMonth;
    }

    // Check limits
    const dailyUsage = userQuota.dailyUsage[provider] || 0;
    const monthlyUsage = userQuota.monthlyUsage[provider] || 0;
    
    if (dailyUsage >= userQuota.limits.daily[provider]) {
      throw new Error(`Daily ${provider} quota exceeded for user ${userId}`);
    }
    
    if (monthlyUsage >= userQuota.limits.monthly[provider]) {
      throw new Error(`Monthly ${provider} quota exceeded for user ${userId}`);
    }
  }

  /**
   * Track API usage and costs
   */
  private trackAPIUsage(provider: string, cost: number, userId?: string): void {
    const now = new Date();
    const today = now.toDateString();
    const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;

    // Update global metrics
    this.metrics.dailySpend += cost;
    this.metrics.monthlySpend += cost;
    this.metrics.costByProvider[provider] = (this.metrics.costByProvider[provider] || 0) + cost;

    // Update user quota if applicable
    if (userId) {
      const userQuota = this.getUserQuota(userId);
      userQuota.dailyUsage[provider] = (userQuota.dailyUsage[provider] || 0) + cost;
      userQuota.monthlyUsage[provider] = (userQuota.monthlyUsage[provider] || 0) + cost;
    }

    // Check budget alerts
    this.checkBudgetAlerts();

    // Update cost tracker
    this.costTracker.record(provider, cost, now);

    this.emit('costTracked', {
      provider,
      cost,
      dailyTotal: this.metrics.dailySpend,
      monthlyTotal: this.metrics.monthlySpend
    });
  }

  /**
   * Track cost savings from optimizations
   */
  private trackCostSaving(type: keyof CostSavings, amount: number): void {
    this.metrics.savings[type] += amount;
    this.metrics.savings.totalSavings += amount;
    
    // Recalculate savings percentage
    const totalSpent = this.metrics.monthlySpend;
    const totalSavings = this.metrics.savings.totalSavings;
    this.metrics.savings.savingsPercentage = totalSpent > 0 
      ? (totalSavings / (totalSpent + totalSavings)) * 100 
      : 0;

    this.emit('costSaved', {
      type,
      amount,
      totalSavings: this.metrics.savings.totalSavings,
      savingsPercentage: this.metrics.savings.savingsPercentage
    });
  }

  /**
   * Check budget alerts and thresholds
   */
  private checkBudgetAlerts(): void {
    const dailyUsage = this.metrics.dailySpend / this.config.dailyBudgetLimit;
    const monthlyUsage = this.metrics.monthlySpend / this.config.monthlyBudgetLimit;

    if (dailyUsage >= this.config.emergencyThreshold) {
      this.emit('budgetAlert', {
        type: 'daily',
        usage: dailyUsage,
        amount: this.metrics.dailySpend,
        limit: this.config.dailyBudgetLimit,
        severity: 'critical'
      });
    } else if (dailyUsage >= 0.8) {
      this.emit('budgetAlert', {
        type: 'daily',
        usage: dailyUsage,
        amount: this.metrics.dailySpend,
        limit: this.config.dailyBudgetLimit,
        severity: 'warning'
      });
    }

    if (monthlyUsage >= this.config.emergencyThreshold) {
      this.emit('budgetAlert', {
        type: 'monthly',
        usage: monthlyUsage,
        amount: this.metrics.monthlySpend,
        limit: this.config.monthlyBudgetLimit,
        severity: 'critical'
      });
    }
  }

  /**
   * Predict cost for upcoming operations
   */
  predictCost(operations: {
    openaiCalls?: number;
    tavilySearches?: number;
    pineconeQueries?: number;
    avgTokensPerCall?: number;
  }): CostPrediction {
    const avgModelCost = this.config.openaiModels.reduce((sum, model) => 
      sum + (model.inputCostPer1k + model.outputCostPer1k), 0
    ) / this.config.openaiModels.length;

    const openaiCost = (operations.openaiCalls || 0) * 
      (avgModelCost * (operations.avgTokensPerCall || 2000) / 1000);
    
    const tavilyCost = (operations.tavilySearches || 0) * 
      this.config.tavilyConfig.costPerSearch;
    
    const pineconeCost = (operations.pineconeQueries || 0) * 
      this.config.pineconeConfig.costPerQuery;

    const totalCost = openaiCost + tavilyCost + pineconeCost;

    return {
      openaiCost,
      tavilyCost,
      pineconeCost,
      totalCost,
      budgetImpact: {
        daily: totalCost / this.config.dailyBudgetLimit,
        monthly: totalCost / this.config.monthlyBudgetLimit
      }
    };
  }

  /**
   * Get comprehensive cost metrics
   */
  getMetrics(): CostMetrics {
    // Update cost per query
    const totalQueries = Object.values(this.metrics.costByProvider)
      .reduce((sum, cost) => sum + cost, 0);
    
    this.metrics.costPerQuery = totalQueries > 0 
      ? this.metrics.monthlySpend / totalQueries 
      : 0;

    // Update projected monthly spend
    const daysInMonth = new Date().getDate();
    const daysRemaining = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - daysInMonth;
    this.metrics.projectedMonthlySpend = this.metrics.monthlySpend + 
      (this.metrics.dailySpend * daysRemaining);

    // Update quota usage
    this.metrics.quotaUsage = {
      daily: {
        used: this.metrics.dailySpend,
        limit: this.config.dailyBudgetLimit,
        percentage: (this.metrics.dailySpend / this.config.dailyBudgetLimit) * 100
      },
      monthly: {
        used: this.metrics.monthlySpend,
        limit: this.config.monthlyBudgetLimit,
        percentage: (this.metrics.monthlySpend / this.config.monthlyBudgetLimit) * 100
      },
      byTier: this.calculateTierUsage()
    };

    return { ...this.metrics };
  }

  // Helper methods and initialization
  private initializeCaches(): void {
    this.responseCache = new LRUCache({
      max: 10000,
      ttl: 6 * 60 * 60 * 1000 // 6 hours
    });

    this.searchCache = new LRUCache({
      max: 5000,
      ttl: this.config.tavilyConfig.cacheHours * 60 * 60 * 1000
    });

    this.vectorCache = new LRUCache({
      max: 15000,
      ttl: this.config.pineconeConfig.cacheHours * 60 * 60 * 1000
    });
  }

  private initializeMetrics(): void {
    this.metrics = {
      dailySpend: 0,
      monthlySpend: 0,
      projectedMonthlySpend: 0,
      costPerQuery: 0,
      costByProvider: {},
      costByModel: {},
      savings: {
        cachingSavings: 0,
        modelOptimizationSavings: 0,
        batchingSavings: 0,
        totalSavings: 0,
        savingsPercentage: 0
      },
      quotaUsage: {
        daily: { used: 0, limit: this.config.dailyBudgetLimit, percentage: 0 },
        monthly: { used: 0, limit: this.config.monthlyBudgetLimit, percentage: 0 },
        byTier: {}
      }
    };
  }

  private startBackgroundTasks(): void {
    // Daily reset
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() === 0) {
        this.metrics.dailySpend = 0;
        this.emit('dailyReset');
      }
    }, 60000); // Check every minute

    // Monthly reset
    setInterval(() => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 0) {
        this.metrics.monthlySpend = 0;
        this.metrics.savings = {
          cachingSavings: 0,
          modelOptimizationSavings: 0,
          batchingSavings: 0,
          totalSavings: 0,
          savingsPercentage: 0
        };
        this.emit('monthlyReset');
      }
    }, 60000);
  }

  private getDefaultModelConfigs(): ModelConfig[] {
    return [
      {
        name: 'gpt-4o',
        inputCostPer1k: 0.005,
        outputCostPer1k: 0.015,
        maxTokens: 128000,
        qualityScore: 95,
        speedScore: 80,
        useCase: ['analysis', 'research', 'complex-reasoning']
      },
      {
        name: 'gpt-4o-mini',
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.0006,
        maxTokens: 128000,
        qualityScore: 85,
        speedScore: 90,
        useCase: ['general', 'simple-analysis', 'summarization']
      },
      {
        name: 'gpt-3.5-turbo',
        inputCostPer1k: 0.0005,
        outputCostPer1k: 0.0015,
        maxTokens: 16384,
        qualityScore: 75,
        speedScore: 95,
        useCase: ['simple-tasks', 'quick-responses', 'classification']
      }
    ];
  }

  // Additional helper methods would be implemented here...
  private generateLLMCacheKey(prompt: string, options: any): string {
    // Implementation
    return '';
  }

  private isCacheValid(cached: any): boolean {
    return cached.expiresAt > Date.now();
  }

  private shouldCache(response: string): boolean {
    return response.length > 100; // Cache substantial responses
  }

  private calculateOpenAICost(tokens: number, model: ModelConfig): number {
    // Simplified cost calculation
    return (tokens / 1000) * (model.inputCostPer1k + model.outputCostPer1k);
  }

  private getUserQuota(userId: string): UserQuota {
    if (!this.userQuotas.has(userId)) {
      this.userQuotas.set(userId, {
        userId,
        dailyUsage: {},
        monthlyUsage: {},
        limits: {
          daily: { openai: 100, tavily: 50, pinecone: 1000 },
          monthly: { openai: 2000, tavily: 1000, pinecone: 20000 }
        },
        lastResetDay: new Date().toDateString(),
        lastResetMonth: `${new Date().getFullYear()}-${new Date().getMonth()}`
      });
    }
    return this.userQuotas.get(userId)!;
  }

  private calculateTierUsage(): Record<string, { used: number; limit: number; percentage: number }> {
    // Implementation for tier-based usage calculation
    return {};
  }

  // Mock implementations for API calls (replace with actual implementations)
  private async executeOpenAICall(prompt: string, model: ModelConfig, options: any): Promise<any> {
    // Mock implementation
    return {
      response: "Mock response",
      tokensUsed: Math.floor(Math.random() * 2000) + 500
    };
  }

  private async executeTavilySearch(query: string, options: any): Promise<any> {
    // Mock implementation
    return {
      results: [{ title: "Mock result", content: "Mock content", url: "https://example.com" }]
    };
  }

  private async executePineconeQuery(vector: number[], options: any): Promise<any> {
    // Mock implementation
    return {
      matches: [{ id: "1", score: 0.95, metadata: {} }]
    };
  }

  private generateSearchCacheKey(query: string, options: any): string {
    return `search_${query}_${JSON.stringify(options)}`;
  }

  private generateVectorCacheKey(vector: number[], options: any): string {
    return `vector_${vector.slice(0, 5).join('_')}_${JSON.stringify(options)}`;
  }

  private deduplicateSearchResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set();
    return results.filter(result => {
      const key = result.url || result.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Helper class for cost tracking
class CostTracker {
  private records: CostRecord[] = [];

  record(provider: string, cost: number, timestamp: Date): void {
    this.records.push({ provider, cost, timestamp });
    
    // Keep only last 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    this.records = this.records.filter(record => record.timestamp > cutoff);
  }

  getHourlyTrend(): HourlyTrend[] {
    // Implementation for hourly cost trends
    return [];
  }

  getDailyTrend(): DailyTrend[] {
    // Implementation for daily cost trends
    return [];
  }
}

// Type definitions
interface CachedResponse {
  response: string;
  model: string;
  tokensUsed: number;
  originalCost: number;
  timestamp: number;
  expiresAt: number;
}

interface CachedSearchResult {
  results: SearchResult[];
  timestamp: number;
  expiresAt: number;
}

interface CachedVectorResult {
  matches: VectorMatch[];
  timestamp: number;
  expiresAt: number;
}

interface SearchResult {
  title: string;
  content: string;
  url: string;
  score?: number;
}

interface VectorMatch {
  id: string;
  score: number;
  metadata: Record<string, any>;
}

interface UserQuota {
  userId: string;
  dailyUsage: Record<string, number>;
  monthlyUsage: Record<string, number>;
  limits: {
    daily: Record<string, number>;
    monthly: Record<string, number>;
  };
  lastResetDay: string;
  lastResetMonth: string;
}

interface OptimizedLLMResponse {
  response: string;
  model: string;
  cost: number;
  tokensUsed: number;
  fromCache: boolean;
  responseTime: number;
}

interface OptimizedSearchResponse {
  results: SearchResult[];
  totalSearches: number;
  cacheHits: number;
  actualSearches: number;
  cost: number;
  responseTime: number;
}

interface OptimizedVectorResponse {
  matches: VectorMatch[];
  cost: number;
  fromCache: boolean;
  responseTime: number;
}

interface CostPrediction {
  openaiCost: number;
  tavilyCost: number;
  pineconeCost: number;
  totalCost: number;
  budgetImpact: {
    daily: number;
    monthly: number;
  };
}

interface CostRecord {
  provider: string;
  cost: number;
  timestamp: Date;
}

interface HourlyTrend {
  hour: number;
  cost: number;
  provider: string;
}

interface DailyTrend {
  date: string;
  cost: number;
  provider: string;
}

export {
  CostOptimizationConfig,
  ModelConfig,
  TavilyConfig,
  PineconeConfig,
  CostMetrics,
  CostSavings,
  QuotaUsage,
  OptimizedLLMResponse,
  OptimizedSearchResponse,
  OptimizedVectorResponse,
  CostPrediction
};