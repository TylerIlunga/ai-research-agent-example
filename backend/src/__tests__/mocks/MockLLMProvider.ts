/**
 * Comprehensive Mock Implementation for LLM Provider
 * Simulates OpenAI API responses with realistic behavior
 */

import { EventEmitter } from 'events';

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, any>;
}

export interface StreamChunk {
  content?: string;
  toolCall?: Partial<ToolCall>;
  done: boolean;
}

export class MockLLMProvider extends EventEmitter {
  private responseQueue: LLMResponse[] = [];
  private streamChunks: StreamChunk[] = [];
  private errorToThrow: Error | null = null;
  private delay: number = 0;
  private callCount: number = 0;
  private totalTokensUsed: number = 0;

  // Configuration
  private defaultModel: string = 'gpt-4o-mini';
  private simulateLatency: boolean = true;
  private simulateTokenUsage: boolean = true;

  constructor() {
    super();
    this.setupDefaultResponses();
  }

  private setupDefaultResponses(): void {
    // Default search-then-analyze pattern
    this.responseQueue = [
      {
        content: 'I need to search for information about this topic.',
        toolCalls: [
          {
            id: 'call_1',
            name: 'tavily_search',
            args: { query: 'research topic latest developments' }
          }
        ]
      },
      {
        content: 'Let me get more specific information from our vector database.',
        toolCalls: [
          {
            id: 'call_2',
            name: 'pinecone_query',
            args: { query: 'detailed analysis', topK: 10 }
          }
        ]
      },
      {
        content: 'Based on my research, here is a comprehensive analysis...',
        toolCalls: []
      }
    ];
  }

  // Mock Methods
  async generateResponse(
    messages: Array<{ role: string; content: string }>,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      tools?: any[];
      stream?: boolean;
    } = {}
  ): Promise<LLMResponse> {
    this.callCount++;

    // Simulate API delay
    if (this.simulateLatency) {
      await this.sleep(this.delay || this.getRandomLatency());
    }

    // Throw error if configured
    if (this.errorToThrow) {
      const error = this.errorToThrow;
      this.errorToThrow = null; // Reset after throwing
      throw error;
    }

    // Get next response from queue or generate default
    const response = this.getNextResponse(messages, options);

    // Simulate token usage
    if (this.simulateTokenUsage) {
      response.usage = this.calculateTokenUsage(messages, response);
      this.totalTokensUsed += response.usage.totalTokens;
    }

    this.emit('apiCall', {
      model: options.model || this.defaultModel,
      tokens: response.usage?.totalTokens || 0,
      cost: this.calculateCost(response.usage),
      callNumber: this.callCount
    });

    return response;
  }

  async generateStreamResponse(
    messages: Array<{ role: string; content: string }>,
    options: any = {}
  ): Promise<AsyncIterable<StreamChunk>> {
    this.callCount++;

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const response = await this.generateResponse(messages, { ...options, stream: false });
    return this.convertToStream(response);
  }

  private async *convertToStream(response: LLMResponse): AsyncIterable<StreamChunk> {
    // Stream tool calls first
    for (const toolCall of response.toolCalls) {
      await this.sleep(50);
      yield {
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args
        },
        done: false
      };
    }

    // Stream content in chunks
    const words = response.content.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      await this.sleep(100);
      const chunk = words.slice(i, i + 3).join(' ');
      yield {
        content: chunk + (i + 3 < words.length ? ' ' : ''),
        done: false
      };
    }

    // Final chunk
    yield { done: true };
  }

  // Configuration Methods
  setNextResponse(response: Partial<LLMResponse>): void {
    this.responseQueue = [{
      content: response.content || 'Mock response',
      toolCalls: response.toolCalls || [],
      usage: response.usage,
      model: response.model || this.defaultModel,
      finishReason: response.finishReason || 'stop'
    }];
  }

  setResponseQueue(responses: Partial<LLMResponse>[]): void {
    this.responseQueue = responses.map(r => ({
      content: r.content || 'Mock response',
      toolCalls: r.toolCalls || [],
      usage: r.usage,
      model: r.model || this.defaultModel,
      finishReason: r.finishReason || 'stop'
    }));
  }

  setError(error: Error): void {
    this.errorToThrow = error;
  }

  setDelay(ms: number): void {
    this.delay = ms;
  }

  setModel(model: string): void {
    this.defaultModel = model;
  }

  // Scenario-specific response patterns
  setSearchScenario(): void {
    this.setResponseQueue([
      {
        content: 'I need to search for recent information about this topic.',
        toolCalls: [
          { name: 'tavily_search', args: { query: 'latest developments research topic' } }
        ]
      },
      {
        content: 'Based on the search results, let me provide a comprehensive analysis.',
        toolCalls: []
      }
    ]);
  }

  setVectorRetrievalScenario(): void {
    this.setResponseQueue([
      {
        content: 'Let me search our knowledge base for relevant information.',
        toolCalls: [
          { name: 'pinecone_query', args: { query: 'research topic', topK: 10 } }
        ]
      },
      {
        content: 'Here is what I found from our knowledge base.',
        toolCalls: []
      }
    ]);
  }

  setComplexResearchScenario(): void {
    this.setResponseQueue([
      {
        content: 'This is a complex topic. Let me search for recent information.',
        toolCalls: [
          { name: 'tavily_search', args: { query: 'complex topic recent developments' } },
          { name: 'tavily_search', args: { query: 'complex topic research papers' } }
        ]
      },
      {
        content: 'Now let me cross-reference with our knowledge base.',
        toolCalls: [
          { name: 'pinecone_query', args: { query: 'complex topic analysis', topK: 15 } }
        ]
      },
      {
        content: 'Let me search for more specific technical details.',
        toolCalls: [
          { name: 'tavily_search', args: { query: 'complex topic technical specifications' } }
        ]
      },
      {
        content: 'Based on all my research, here is a comprehensive analysis of the complex topic.',
        toolCalls: []
      }
    ]);
  }

  setErrorRecoveryScenario(): void {
    this.setResponseQueue([
      {
        content: 'Let me try to search for information.',
        toolCalls: [
          { name: 'tavily_search', args: { query: 'search query' } }
        ]
      },
      {
        content: 'The search encountered an issue. Let me try our vector database instead.',
        toolCalls: [
          { name: 'pinecone_query', args: { query: 'fallback query', topK: 5 } }
        ]
      },
      {
        content: 'Based on the available information, here is my analysis.',
        toolCalls: []
      }
    ]);
  }

  // Utility Methods
  private getNextResponse(
    messages: Array<{ role: string; content: string }>,
    options: any
  ): LLMResponse {
    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }

    // Generate contextual response based on conversation
    return this.generateContextualResponse(messages, options);
  }

  private generateContextualResponse(
    messages: Array<{ role: string; content: string }>,
    _options: any
  ): LLMResponse {
    const lastMessage = messages[messages.length - 1];
    const query = this.extractQuery(messages);

    // Determine response based on context
    if (this.needsSearch(lastMessage, messages)) {
      return {
        content: `I need to search for information about "${query}".`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'tavily_search',
            args: { query: this.generateSearchQuery(query) }
          }
        ]
      };
    }

    if (this.needsVectorRetrieval(lastMessage, messages)) {
      return {
        content: 'Let me check our knowledge base for more specific information.',
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: 'pinecone_query',
            args: { query: query, topK: 10 }
          }
        ]
      };
    }

    // Final analysis response
    return {
      content: this.generateAnalysisResponse(query, messages),
      toolCalls: []
    };
  }

  private needsSearch(lastMessage: any, messages: any[]): boolean {
    // Simple heuristic: need search if no tool results yet
    return !messages.some(m => m.role === 'tool');
  }

  private needsVectorRetrieval(lastMessage: any, messages: any[]): boolean {
    // Need vector retrieval after search but before final analysis
    const hasSearchResults = messages.some(m => m.role === 'tool' && m.content?.includes('search'));
    const hasVectorResults = messages.some(m => m.role === 'tool' && m.content?.includes('vector'));
    return hasSearchResults && !hasVectorResults && Math.random() > 0.3;
  }

  private extractQuery(messages: Array<{ role: string; content: string }>): string {
    const userMessage = messages.find(m => m.role === 'user');
    return userMessage?.content || 'research topic';
  }

  private generateSearchQuery(query: string): string {
    const keywords = query.split(' ').slice(0, 5).join(' ');
    return `${keywords} latest developments 2024`;
  }

  private generateAnalysisResponse(query: string, _messages: any[]): string {
    const templates = [
      `Based on my research, here are the key findings about ${query}:`,
      `After analyzing the available information on ${query}, I can provide this comprehensive overview:`,
      `My research on ${query} reveals several important insights:`,
      `Here is a detailed analysis of ${query} based on current information:`
    ];

    const template = templates[Math.floor(Math.random() * templates.length)];
    
    return `${template}

## Key Findings
- Important development in the field
- Significant research breakthrough
- Notable trend or pattern
- Future implications and possibilities

## Analysis
The research indicates that ${query} is an evolving area with significant developments. Current trends suggest continued growth and innovation in this space.

## Conclusion
Based on the available evidence, ${query} represents an important area for continued research and development.`;
  }

  private calculateTokenUsage(
    messages: Array<{ role: string; content: string }>,
    response: LLMResponse
  ): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const promptTokens = messages.reduce((total, msg) => 
      total + this.estimateTokens(msg.content), 0
    );
    
    const completionTokens = this.estimateTokens(response.content) +
      response.toolCalls.reduce((total, call) => 
        total + this.estimateTokens(JSON.stringify(call)), 0
      );

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private calculateCost(usage?: { promptTokens: number; completionTokens: number }): number {
    if (!usage) return 0;
    
    // Mock pricing for gpt-4o-mini
    const inputCost = 0.00015; // per 1K tokens
    const outputCost = 0.0006; // per 1K tokens
    
    return (usage.promptTokens / 1000 * inputCost) + 
           (usage.completionTokens / 1000 * outputCost);
  }

  private getRandomLatency(): number {
    // Simulate realistic API latency (200-2000ms)
    return Math.random() * 1800 + 200;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test utilities
  getCallCount(): number {
    return this.callCount;
  }

  getTotalTokensUsed(): number {
    return this.totalTokensUsed;
  }

  reset(): void {
    this.callCount = 0;
    this.totalTokensUsed = 0;
    this.responseQueue = [];
    this.errorToThrow = null;
    this.delay = 0;
    this.setupDefaultResponses();
  }

  // Mock specific OpenAI methods
  createChatCompletion = this.generateResponse;
  createChatCompletionStream = this.generateStreamResponse;

  // Mock embeddings
  async createEmbedding(_text: string): Promise<number[]> {
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    await this.sleep(this.delay || 100);
    
    // Return mock embedding vector (1536 dimensions for OpenAI)
    return Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
  }

  // Mock moderation
  async moderate(_text: string): Promise<{ flagged: boolean; categories: any }> {
    await this.sleep(50);
    
    return {
      flagged: false,
      categories: {
        hate: false,
        'hate/threatening': false,
        harassment: false,
        'harassment/threatening': false,
        'self-harm': false,
        'self-harm/intent': false,
        'self-harm/instructions': false,
        sexual: false,
        'sexual/minors': false,
        violence: false,
        'violence/graphic': false
      }
    };
  }
}