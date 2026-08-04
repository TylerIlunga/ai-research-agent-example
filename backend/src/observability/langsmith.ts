import { Client } from 'langsmith';
import { CallbackHandler } from 'langsmith/langchain';
import { BaseMessage } from '@langchain/core/messages';
import { Document } from '@langchain/core/documents';

// Enhanced LangSmith configuration
const langsmith = new Client({
  apiUrl: process.env.LANGCHAIN_ENDPOINT || 'https://api.smith.langchain.com',
  apiKey: process.env.LANGCHAIN_API_KEY,
  callerOptions: {
    maxRetries: 3,
    maxConcurrency: 10,
  },
});

// Detailed tracing interfaces
interface LangGraphStateTransition {
  node: string;
  fromState: any;
  toState: any;
  timestamp: number;
  duration: number;
  memoryUsage: number;
  error?: string;
}

interface ToolInvocation {
  toolName: string;
  parameters: Record<string, any>;
  result: any;
  duration: number;
  tokensUsed?: number;
  cost?: number;
  error?: string;
  metadata: {
    provider: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

interface TokenUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  model: string;
  provider: string;
}

interface ResearchTraceData {
  sessionId: string;
  conversationId: string;
  query: string;
  userId?: string;
  startTime: number;
  endTime?: number;
  stateTransitions: LangGraphStateTransition[];
  toolInvocations: ToolInvocation[];
  tokenUsage: TokenUsageMetrics[];
  sourcesFound: number;
  success: boolean;
  errorDetails?: {
    type: string;
    message: string;
    stack?: string;
    node?: string;
  };
  metadata: {
    userTier: string;
    ipAddress: string;
    userAgent: string;
    debugMode: boolean;
  };
}

// Enhanced LangSmith callback handler
export class EnhancedLangSmithHandler extends CallbackHandler {
  private traceData: Map<string, ResearchTraceData> = new Map();
  private activeRuns: Map<string, { startTime: number; node?: string }> = new Map();

  constructor(options: {
    projectName?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
  } = {}) {
    super({
      projectName: options.projectName || 'ai-research-agent',
      sessionId: options.sessionId,
      metadata: {
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        ...options.metadata,
      },
    });
  }

  // Initialize trace for new research session
  initializeTrace(sessionId: string, query: string, metadata: ResearchTraceData['metadata']): void {
    this.traceData.set(sessionId, {
      sessionId,
      conversationId: metadata.userAgent || '',
      query,
      startTime: Date.now(),
      stateTransitions: [],
      toolInvocations: [],
      tokenUsage: [],
      sourcesFound: 0,
      success: false,
      metadata,
    });
  }

  // Track LangGraph state transitions
  onStateTransition(sessionId: string, transition: Omit<LangGraphStateTransition, 'timestamp' | 'memoryUsage'>): void {
    const traceData = this.traceData.get(sessionId);
    if (!traceData) return;

    const memoryUsage = process.memoryUsage();
    
    traceData.stateTransitions.push({
      ...transition,
      timestamp: Date.now(),
      memoryUsage: memoryUsage.heapUsed,
    });

    // Log state transition to LangSmith
    this.logCustomEvent(sessionId, 'state_transition', {
      node: transition.node,
      duration: transition.duration,
      memoryUsage: memoryUsage.heapUsed,
      stateSize: JSON.stringify(transition.toState).length,
    });
  }

  // Track tool invocations with detailed metrics
  async onToolStart(
    tool: { name: string },
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await super.onToolStart(tool, input, runId, parentRunId, tags, metadata);
    
    this.activeRuns.set(runId, {
      startTime: Date.now(),
      node: metadata?.langgraph_node,
    });

    // Log tool start with parameters
    const sessionId = metadata?.sessionId;
    if (sessionId) {
      this.logCustomEvent(sessionId, 'tool_start', {
        toolName: tool.name,
        parameters: this.sanitizeParameters(input),
        node: metadata?.langgraph_node,
      });
    }
  }

  async onToolEnd(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await super.onToolEnd(output, runId, parentRunId, tags, metadata);

    const runInfo = this.activeRuns.get(runId);
    if (!runInfo) return;

    const duration = Date.now() - runInfo.startTime;
    const sessionId = metadata?.sessionId;
    
    if (sessionId) {
      const traceData = this.traceData.get(sessionId);
      if (traceData) {
        const toolInvocation: ToolInvocation = {
          toolName: metadata?.tool_name || 'unknown',
          parameters: this.sanitizeParameters(metadata?.input || ''),
          result: this.sanitizeResult(output),
          duration,
          tokensUsed: metadata?.tokensUsed,
          cost: metadata?.cost,
          metadata: {
            provider: metadata?.provider || 'unknown',
            model: metadata?.model,
            temperature: metadata?.temperature,
            maxTokens: metadata?.maxTokens,
          },
        };

        traceData.toolInvocations.push(toolInvocation);

        // Update sources found if this was a search tool
        if (metadata?.tool_name === 'tavily_search') {
          try {
            const result = JSON.parse(output);
            if (Array.isArray(result)) {
              traceData.sourcesFound += result.length;
            }
          } catch (e) {
            // Non-JSON result, count as 1 source if successful
            traceData.sourcesFound += 1;
          }
        }
      }

      // Log detailed tool completion
      this.logCustomEvent(sessionId, 'tool_end', {
        toolName: metadata?.tool_name,
        duration,
        success: !metadata?.error,
        tokensUsed: metadata?.tokensUsed,
        cost: metadata?.cost,
        resultSize: output.length,
        node: runInfo.node,
      });
    }

    this.activeRuns.delete(runId);
  }

  async onToolError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await super.onToolError(error, runId, parentRunId, tags, metadata);

    const runInfo = this.activeRuns.get(runId);
    if (!runInfo) return;

    const duration = Date.now() - runInfo.startTime;
    const sessionId = metadata?.sessionId;
    
    if (sessionId) {
      const traceData = this.traceData.get(sessionId);
      if (traceData) {
        const toolInvocation: ToolInvocation = {
          toolName: metadata?.tool_name || 'unknown',
          parameters: this.sanitizeParameters(metadata?.input || ''),
          result: null,
          duration,
          error: error.message,
          metadata: {
            provider: metadata?.provider || 'unknown',
            model: metadata?.model,
          },
        };

        traceData.toolInvocations.push(toolInvocation);
      }

      this.logCustomEvent(sessionId, 'tool_error', {
        toolName: metadata?.tool_name,
        error: error.message,
        duration,
        node: runInfo.node,
      });
    }

    this.activeRuns.delete(runId);
  }

  // Track LLM token usage
  async onLLMEnd(
    output: any,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>
  ): Promise<void> {
    await super.onLLMEnd(output, runId, parentRunId, tags, metadata);

    const sessionId = metadata?.sessionId;
    if (sessionId && output.llmOutput?.tokenUsage) {
      const traceData = this.traceData.get(sessionId);
      if (traceData) {
        const tokenMetrics: TokenUsageMetrics = {
          promptTokens: output.llmOutput.tokenUsage.promptTokens || 0,
          completionTokens: output.llmOutput.tokenUsage.completionTokens || 0,
          totalTokens: output.llmOutput.tokenUsage.totalTokens || 0,
          cost: this.calculateCost(output.llmOutput.tokenUsage, metadata?.model),
          model: metadata?.model || 'unknown',
          provider: metadata?.provider || 'openai',
        };

        traceData.tokenUsage.push(tokenMetrics);
      }

      this.logCustomEvent(sessionId, 'llm_completion', {
        model: metadata?.model,
        promptTokens: output.llmOutput.tokenUsage.promptTokens,
        completionTokens: output.llmOutput.tokenUsage.completionTokens,
        totalTokens: output.llmOutput.tokenUsage.totalTokens,
        cost: this.calculateCost(output.llmOutput.tokenUsage, metadata?.model),
      });
    }
  }

  // Complete trace and send to LangSmith
  async completeTrace(sessionId: string, success: boolean, error?: Error): Promise<void> {
    const traceData = this.traceData.get(sessionId);
    if (!traceData) return;

    traceData.endTime = Date.now();
    traceData.success = success;
    
    if (error) {
      traceData.errorDetails = {
        type: error.constructor.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Calculate aggregate metrics
    const totalDuration = traceData.endTime - traceData.startTime;
    const totalTokens = traceData.tokenUsage.reduce((sum, usage) => sum + usage.totalTokens, 0);
    const totalCost = traceData.tokenUsage.reduce((sum, usage) => sum + usage.cost, 0);

    // Send comprehensive trace to LangSmith
    await this.logCustomEvent(sessionId, 'research_completion', {
      duration: totalDuration,
      success,
      stateTransitions: traceData.stateTransitions.length,
      toolInvocations: traceData.toolInvocations.length,
      sourcesFound: traceData.sourcesFound,
      totalTokens,
      totalCost,
      query: traceData.query,
      userTier: traceData.metadata.userTier,
      errorType: error?.constructor.name,
    });

    // Store detailed trace data
    await this.storeTraceData(traceData);
    
    // Clean up
    this.traceData.delete(sessionId);
  }

  // Custom event logging
  private async logCustomEvent(sessionId: string, eventType: string, data: Record<string, any>): Promise<void> {
    try {
      await langsmith.createRun({
        name: eventType,
        runType: 'tool',
        inputs: { eventType, sessionId },
        outputs: data,
        sessionName: sessionId,
        projectName: this.projectName,
        extra: {
          metadata: {
            timestamp: Date.now(),
            environment: process.env.NODE_ENV,
            version: process.env.npm_package_version,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log event to LangSmith:', error);
    }
  }

  // Store detailed trace data for analysis
  private async storeTraceData(traceData: ResearchTraceData): Promise<void> {
    try {
      // In production, this would go to a database or data warehouse
      console.log('Storing trace data:', {
        sessionId: traceData.sessionId,
        duration: traceData.endTime! - traceData.startTime,
        success: traceData.success,
        sourcesFound: traceData.sourcesFound,
        totalTokens: traceData.tokenUsage.reduce((sum, usage) => sum + usage.totalTokens, 0),
      });

      // Store in LangSmith dataset for future analysis
      await langsmith.createDataset({
        name: `research-traces-${new Date().toISOString().split('T')[0]}`,
        description: 'Daily research agent trace data',
      }).catch(() => {}); // Dataset might already exist

      await langsmith.createExample({
        datasetName: `research-traces-${new Date().toISOString().split('T')[0]}`,
        inputs: {
          query: traceData.query,
          userTier: traceData.metadata.userTier,
        },
        outputs: {
          success: traceData.success,
          duration: traceData.endTime! - traceData.startTime,
          sourcesFound: traceData.sourcesFound,
          stateTransitions: traceData.stateTransitions.length,
          toolInvocations: traceData.toolInvocations.length,
          totalTokens: traceData.tokenUsage.reduce((sum, usage) => sum + usage.totalTokens, 0),
          totalCost: traceData.tokenUsage.reduce((sum, usage) => sum + usage.cost, 0),
        },
        metadata: {
          sessionId: traceData.sessionId,
          timestamp: traceData.startTime,
          errorDetails: traceData.errorDetails,
        },
      });
    } catch (error) {
      console.error('Failed to store trace data:', error);
    }
  }

  // Utility methods
  private sanitizeParameters(input: any): any {
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return this.sanitizeObject(parsed);
      } catch {
        return { query: input.length > 1000 ? input.substring(0, 1000) + '...' : input };
      }
    }
    return this.sanitizeObject(input);
  }

  private sanitizeResult(output: any): any {
    if (typeof output === 'string') {
      if (output.length > 5000) {
        return output.substring(0, 5000) + '...';
      }
      return output;
    }
    return this.sanitizeObject(output);
  }

  private sanitizeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '...';
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private calculateCost(tokenUsage: any, model?: string): number {
    // Cost calculation based on model pricing
    const costs = {
      'gpt-4o-mini': {
        prompt: 0.00015 / 1000, // $0.15 per 1M tokens
        completion: 0.0006 / 1000, // $0.60 per 1M tokens
      },
      'gpt-4o': {
        prompt: 0.005 / 1000, // $5 per 1M tokens
        completion: 0.015 / 1000, // $15 per 1M tokens
      },
      'text-embedding-ada-002': {
        prompt: 0.0001 / 1000, // $0.10 per 1M tokens
        completion: 0,
      },
    };

    const modelCosts = costs[model as keyof typeof costs] || costs['gpt-4o-mini'];
    
    return (
      (tokenUsage.promptTokens || 0) * modelCosts.prompt +
      (tokenUsage.completionTokens || 0) * modelCosts.completion
    );
  }
}

// Global handler instance
export const globalLangSmithHandler = new EnhancedLangSmithHandler({
  projectName: 'ai-research-agent-production',
});

// Utility functions for integration
export const createSessionHandler = (sessionId: string, metadata: any) => {
  return new EnhancedLangSmithHandler({
    projectName: 'ai-research-agent',
    sessionId,
    metadata,
  });
};

export { ResearchTraceData, ToolInvocation, TokenUsageMetrics, LangGraphStateTransition };