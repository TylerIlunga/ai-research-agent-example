/**
 * Comprehensive Mock Implementation for Search Provider
 * Simulates Tavily API responses with realistic search results
 */

import { EventEmitter } from 'events';

export interface SearchResult {
  title: string;
  content: string;
  url: string;
  score: number;
  publishedDate?: string;
  domain?: string;
  imageUrl?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  searchTime: number;
  totalResults: number;
  nextPage?: string;
}

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeImages?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  dateRange?: {
    from: string;
    to: string;
  };
}

export class MockSearchProvider extends EventEmitter {
  private searchResults: SearchResult[] = [];
  private errorToThrow: Error | null = null;
  private delay: number = 0;
  private globalDelay: number = 0;
  private callCount: number = 0;
  private conditionalErrors: Map<string, Error> = new Map();

  // Mock data sets
  private defaultResults: SearchResult[] = [
    {
      title: 'Artificial Intelligence Latest Developments 2024',
      content: 'Recent breakthroughs in artificial intelligence include significant advances in large language models, computer vision, and robotics. Key developments this year have focused on improving efficiency, reducing computational costs, and expanding real-world applications.',
      url: 'https://example.com/ai-developments-2024',
      score: 0.95,
      publishedDate: '2024-01-15',
      domain: 'example.com'
    },
    {
      title: 'Machine Learning Research Breakthroughs',
      content: 'The machine learning community has seen remarkable progress in areas such as federated learning, reinforcement learning, and neural architecture search. These advances are enabling more robust and efficient AI systems.',
      url: 'https://research.example.org/ml-breakthroughs',
      score: 0.92,
      publishedDate: '2024-01-10',
      domain: 'research.example.org'
    },
    {
      title: 'Deep Learning Applications in Healthcare',
      content: 'Deep learning technologies are revolutionizing healthcare through improved diagnostic tools, drug discovery processes, and personalized treatment plans. Recent studies show significant improvements in accuracy and efficiency.',
      url: 'https://healthcare.ai/deep-learning-applications',
      score: 0.88,
      publishedDate: '2024-01-08',
      domain: 'healthcare.ai'
    },
    {
      title: 'Computer Vision Advances in Autonomous Systems',
      content: 'Computer vision technology has made substantial progress in autonomous vehicle navigation, drone operations, and robotic perception systems. New algorithms provide better object detection and scene understanding.',
      url: 'https://autonomous.tech/computer-vision-advances',
      score: 0.85,
      publishedDate: '2024-01-05',
      domain: 'autonomous.tech'
    },
    {
      title: 'Natural Language Processing Innovation',
      content: 'Natural language processing has evolved with new transformer architectures, improved multilingual capabilities, and better understanding of context and nuance in human communication.',
      url: 'https://nlp.research.com/innovation-2024',
      score: 0.82,
      publishedDate: '2024-01-03',
      domain: 'nlp.research.com'
    }
  ];

  constructor() {
    super();
    this.searchResults = [...this.defaultResults];
  }

  // Main search method
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    this.callCount++;
    const startTime = Date.now();

    // Apply delays
    const totalDelay = this.delay + this.globalDelay;
    if (totalDelay > 0) {
      await this.sleep(totalDelay);
    }

    // Check for conditional errors
    if (this.conditionalErrors.has(query)) {
      throw this.conditionalErrors.get(query)!;
    }

    // Check for general errors
    if (this.errorToThrow) {
      const error = this.errorToThrow;
      this.errorToThrow = null; // Reset after throwing
      throw error;
    }

    // Generate contextual results
    const results = this.generateContextualResults(query, options);
    const searchTime = Date.now() - startTime;

    const response: SearchResponse = {
      results,
      query,
      searchTime,
      totalResults: results.length * 10, // Simulate larger result set
      nextPage: results.length >= (options.maxResults || 10) ? `page_2_${query}` : undefined
    };

    this.emit('searchCompleted', {
      query,
      resultCount: results.length,
      searchTime,
      callNumber: this.callCount
    });

    return response;
  }

  // Batch search for multiple queries
  async batchSearch(
    queries: string[],
    options: SearchOptions = {}
  ): Promise<SearchResponse[]> {
    const batchStartTime = Date.now();
    
    // Simulate batch processing with some parallelization
    const batchSize = 3;
    const results: SearchResponse[] = [];

    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchPromises = batch.map(query => this.search(query, options));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    this.emit('batchSearchCompleted', {
      queryCount: queries.length,
      totalTime: Date.now() - batchStartTime,
      totalResults: results.reduce((sum, r) => sum + r.results.length, 0)
    });

    return results;
  }

  // Configuration methods
  setSearchResults(results: SearchResult[]): void {
    this.searchResults = results;
  }

  addSearchResult(result: SearchResult): void {
    this.searchResults.push(result);
  }

  setError(error: Error): void {
    this.errorToThrow = error;
  }

  setConditionalError(query: string, error: Error): void {
    this.conditionalErrors.set(query, error);
  }

  setDelay(ms: number): void {
    this.delay = ms;
  }

  setGlobalDelay(ms: number): void {
    this.globalDelay = ms;
  }

  // Scenario-specific configurations
  setEmptyResultsScenario(): void {
    this.searchResults = [];
  }

  setHighRelevanceScenario(): void {
    this.searchResults = this.defaultResults.map(result => ({
      ...result,
      score: Math.max(0.9, result.score)
    }));
  }

  setLowRelevanceScenario(): void {
    this.searchResults = this.defaultResults.map(result => ({
      ...result,
      score: Math.min(0.6, result.score),
      content: result.content.substring(0, 100) + '...' // Truncated content
    }));
  }

  setMixedQualityScenario(): void {
    this.searchResults = [
      ...this.defaultResults.slice(0, 2), // High quality
      {
        title: 'Low Quality Result',
        content: 'This is a very short and not very informative result.',
        url: 'https://low-quality.example.com/page',
        score: 0.45,
        publishedDate: '2023-12-01',
        domain: 'low-quality.example.com'
      },
      {
        title: 'Outdated Information',
        content: 'This article contains outdated information that may no longer be relevant.',
        url: 'https://outdated.example.com/old-article',
        score: 0.52,
        publishedDate: '2020-01-01',
        domain: 'outdated.example.com'
      }
    ];
  }

  setTechnicalTopicScenario(topic: string): void {
    this.searchResults = [
      {
        title: `${topic} Technical Documentation`,
        content: `Comprehensive technical documentation for ${topic} including implementation details, best practices, and code examples. This resource covers advanced concepts and practical applications.`,
        url: `https://docs.example.com/${topic.toLowerCase()}`,
        score: 0.96,
        publishedDate: '2024-01-20',
        domain: 'docs.example.com'
      },
      {
        title: `${topic} Research Papers and Studies`,
        content: `Academic research papers and peer-reviewed studies on ${topic}. Recent publications include experimental results, theoretical frameworks, and comparative analyses.`,
        url: `https://academic.example.edu/${topic}-research`,
        score: 0.94,
        publishedDate: '2024-01-18',
        domain: 'academic.example.edu'
      },
      {
        title: `${topic} Implementation Guide`,
        content: `Step-by-step implementation guide for ${topic} with practical examples, code snippets, and troubleshooting tips. Suitable for developers and engineers.`,
        url: `https://guides.example.com/${topic}-implementation`,
        score: 0.91,
        publishedDate: '2024-01-15',
        domain: 'guides.example.com'
      }
    ];
  }

  setNewsScenario(topic: string): void {
    this.searchResults = [
      {
        title: `Breaking: Major ${topic} Development Announced`,
        content: `Industry leaders have announced a significant breakthrough in ${topic} that could revolutionize the field. The development promises to address key challenges and open new possibilities.`,
        url: `https://news.example.com/breaking-${topic}-development`,
        score: 0.93,
        publishedDate: new Date().toISOString().split('T')[0],
        domain: 'news.example.com'
      },
      {
        title: `${topic} Market Analysis and Trends`,
        content: `Latest market analysis shows growing trends in ${topic} adoption across industries. Key metrics indicate strong growth potential and increasing investment interest.`,
        url: `https://market.example.com/${topic}-trends`,
        score: 0.89,
        publishedDate: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        domain: 'market.example.com'
      }
    ];
  }

  // Private helper methods
  private generateContextualResults(
    query: string,
    options: SearchOptions
  ): SearchResult[] {
    let results = [...this.searchResults];

    // Filter by query relevance
    results = this.filterByRelevance(results, query);

    // Apply domain filters
    if (options.includeDomains?.length) {
      results = results.filter(r => 
        options.includeDomains!.some(domain => r.domain?.includes(domain))
      );
    }

    if (options.excludeDomains?.length) {
      results = results.filter(r => 
        !options.excludeDomains!.some(domain => r.domain?.includes(domain))
      );
    }

    // Apply date range filter
    if (options.dateRange) {
      results = results.filter(r => {
        if (!r.publishedDate) return true;
        const publishedDate = new Date(r.publishedDate);
        const fromDate = new Date(options.dateRange!.from);
        const toDate = new Date(options.dateRange!.to);
        return publishedDate >= fromDate && publishedDate <= toDate;
      });
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Apply result limit
    const maxResults = options.maxResults || 10;
    results = results.slice(0, maxResults);

    // Adjust content based on search depth
    if (options.searchDepth === 'basic') {
      results = results.map(r => ({
        ...r,
        content: r.content.substring(0, 200) + '...'
      }));
    }

    return results;
  }

  private filterByRelevance(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = query.toLowerCase().split(' ');
    
    return results.map(result => {
      // Calculate relevance score based on term matches
      const titleMatches = this.countMatches(result.title.toLowerCase(), queryTerms);
      const contentMatches = this.countMatches(result.content.toLowerCase(), queryTerms);
      
      // Boost score based on relevance
      const relevanceBoost = (titleMatches * 0.3 + contentMatches * 0.1) / queryTerms.length;
      const adjustedScore = Math.min(0.99, result.score + relevanceBoost);

      return {
        ...result,
        score: adjustedScore
      };
    }).filter(result => result.score > 0.3); // Filter out very low relevance
  }

  private countMatches(text: string, terms: string[]): number {
    return terms.reduce((count, term) => {
      return count + (text.includes(term) ? 1 : 0);
    }, 0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Advanced search features
  async searchWithImages(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const response = await this.search(query, { ...options, includeImages: true });
    
    // Add image URLs to some results
    response.results = response.results.map((result, index) => {
      if (index < 3) { // Add images to first 3 results
        return {
          ...result,
          imageUrl: `https://images.example.com/${query.replace(/\s+/g, '-')}-${index + 1}.jpg`
        };
      }
      return result;
    });

    return response;
  }

  async searchSimilar(originalQuery: string, similarQueries: string[]): Promise<SearchResponse[]> {
    const allQueries = [originalQuery, ...similarQueries];
    return this.batchSearch(allQueries);
  }

  // Test utilities
  getCallCount(): number {
    return this.callCount;
  }

  getLastQuery(): string | null {
    return this.lastQuery || null;
  }

  private lastQuery: string | null = null;

  reset(): void {
    this.callCount = 0;
    this.searchResults = [...this.defaultResults];
    this.errorToThrow = null;
    this.delay = 0;
    this.globalDelay = 0;
    this.conditionalErrors.clear();
    this.lastQuery = null;
  }

  // Mock rate limiting
  private rateLimitRequests: number = 0;
  private rateLimitWindow: number = Date.now();

  private checkRateLimit(): void {
    const now = Date.now();
    const windowSize = 60000; // 1 minute window
    
    if (now - this.rateLimitWindow > windowSize) {
      this.rateLimitRequests = 0;
      this.rateLimitWindow = now;
    }

    this.rateLimitRequests++;
    
    if (this.rateLimitRequests > 100) { // 100 requests per minute limit
      throw new Error('Rate limit exceeded: Too many requests');
    }
  }

  // Mock quota management
  private quotaUsed: number = 0;
  private quotaLimit: number = 10000;

  private checkQuota(): void {
    this.quotaUsed++;
    
    if (this.quotaUsed > this.quotaLimit) {
      throw new Error('Quota exceeded: Monthly search limit reached');
    }
  }

  setQuotaLimit(limit: number): void {
    this.quotaLimit = limit;
  }

  getQuotaUsage(): { used: number; limit: number; remaining: number } {
    return {
      used: this.quotaUsed,
      limit: this.quotaLimit,
      remaining: this.quotaLimit - this.quotaUsed
    };
  }

  // Health check
  async healthCheck(): Promise<{ status: string; latency: number; quota: any }> {
    const start = Date.now();
    await this.sleep(50); // Simulate health check latency
    const latency = Date.now() - start;

    return {
      status: this.errorToThrow ? 'unhealthy' : 'healthy',
      latency,
      quota: this.getQuotaUsage()
    };
  }
}