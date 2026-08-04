import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { globalLangSmithHandler } from './langsmith';
import { metricsCollector } from './metrics';
import { errorTracker } from './errorTracking';

// Debug mode interfaces
interface DebugSession {
  id: string;
  userId?: string;
  startTime: number;
  endTime?: number;
  mode: 'verbose' | 'step' | 'trace' | 'capture';
  filters: DebugFilter[];
  capturedData: DebugCapture[];
  metadata: Record<string, any>;
}

interface DebugFilter {
  type: 'component' | 'event' | 'user' | 'severity';
  value: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'regex';
}

interface DebugCapture {
  timestamp: number;
  type: 'log' | 'event' | 'state' | 'tool' | 'prompt' | 'response' | 'error';
  component: string;
  data: any;
  context: {
    sessionId?: string;
    userId?: string;
    step?: string;
    node?: string;
  };
  metadata: Record<string, any>;
}

interface StateInspection {
  timestamp: number;
  sessionId: string;
  node: string;
  state: any;
  messages: any[];
  variables: Record<string, any>;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

interface ToolResult {
  timestamp: number;
  sessionId: string;
  toolName: string;
  input: any;
  output: any;
  duration: number;
  success: boolean;
  error?: string;
  metadata: Record<string, any>;
}

interface PromptCapture {
  timestamp: number;
  sessionId: string;
  model: string;
  prompt: string;
  response: string;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  settings: {
    temperature: number;
    maxTokens: number;
    topP?: number;
    frequencyPenalty?: number;
  };
}

// Debug manager class
export class DebugManager extends EventEmitter {
  private activeSessions: Map<string, DebugSession> = new Map();
  private globalDebugMode = false;
  private verboseLogging = false;
  private capturedLogs: DebugCapture[] = [];
  private stateHistory: Map<string, StateInspection[]> = new Map();
  private toolHistory: Map<string, ToolResult[]> = new Map();
  private promptHistory: Map<string, PromptCapture[]> = new Map();
  private maxHistorySize = 10000;
  private debugOutputDir = process.env.DEBUG_OUTPUT_DIR || './debug-output';

  constructor() {
    super();
    this.initializeDebugMode();
    this.setupEventListeners();
  }

  // Initialize debug mode from environment
  private initializeDebugMode(): void {
    this.globalDebugMode = process.env.DEBUG_MODE === 'true';
    this.verboseLogging = process.env.VERBOSE_LOGGING === 'true';
    
    if (this.globalDebugMode) {
      console.log('🐛 Debug mode enabled globally');
      this.startGlobalDebugSession();
    }

    // Ensure debug output directory exists
    this.ensureDebugDirectory();
  }

  // Start debug session
  async startDebugSession(config: {
    userId?: string;
    mode: 'verbose' | 'step' | 'trace' | 'capture';
    filters?: DebugFilter[];
    duration?: number; // milliseconds
    metadata?: Record<string, any>;
  }): Promise<string> {
    const sessionId = `debug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const session: DebugSession = {
      id: sessionId,
      userId: config.userId,
      startTime: Date.now(),
      mode: config.mode,
      filters: config.filters || [],
      capturedData: [],
      metadata: config.metadata || {},
    };

    this.activeSessions.set(sessionId, session);

    // Auto-end session if duration is specified
    if (config.duration) {
      setTimeout(() => {
        this.endDebugSession(sessionId);
      }, config.duration);
    }

    console.log(`🐛 Debug session started: ${sessionId} (mode: ${config.mode})`);
    
    this.emit('debug_session_started', {
      sessionId,
      config,
      timestamp: Date.now(),
    });

    return sessionId;
  }

  // End debug session
  async endDebugSession(sessionId: string): Promise<DebugSession | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    session.endTime = Date.now();
    this.activeSessions.delete(sessionId);

    // Save debug data to file
    await this.saveDebugSession(session);

    console.log(`🐛 Debug session ended: ${sessionId} (duration: ${session.endTime - session.startTime}ms)`);
    
    this.emit('debug_session_ended', {
      sessionId,
      duration: session.endTime - session.startTime,
      capturedItems: session.capturedData.length,
      timestamp: Date.now(),
    });

    return session;
  }

  // Toggle global debug mode
  setGlobalDebugMode(enabled: boolean): void {
    this.globalDebugMode = enabled;
    
    if (enabled) {
      console.log('🐛 Global debug mode enabled');
      this.startGlobalDebugSession();
    } else {
      console.log('🐛 Global debug mode disabled');
      // End global session if exists
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.metadata.global) {
          this.endDebugSession(sessionId);
        }
      }
    }
  }

  // Toggle verbose logging
  setVerboseLogging(enabled: boolean): void {
    this.verboseLogging = enabled;
    console.log(`🐛 Verbose logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Capture debug data
  captureDebugData(
    type: DebugCapture['type'],
    component: string,
    data: any,
    context: DebugCapture['context'] = {},
    metadata: Record<string, any> = {}
  ): void {
    const capture: DebugCapture = {
      timestamp: Date.now(),
      type,
      component,
      data: this.sanitizeDebugData(data),
      context,
      metadata,
    };

    // Add to global captured logs
    this.capturedLogs.push(capture);
    
    // Maintain max history size
    if (this.capturedLogs.length > this.maxHistorySize) {
      this.capturedLogs.splice(0, this.capturedLogs.length - this.maxHistorySize);
    }

    // Add to active debug sessions that match filters
    for (const session of this.activeSessions.values()) {
      if (this.matchesFilters(capture, session.filters)) {
        session.capturedData.push(capture);
      }
    }

    // Emit for real-time debugging
    this.emit('debug_capture', capture);

    // Verbose logging
    if (this.verboseLogging) {
      console.log(`🐛 [${type}] ${component}:`, data);
    }
  }

  // Capture state inspection
  captureStateInspection(sessionId: string, node: string, state: any, messages: any[]): void {
    const inspection: StateInspection = {
      timestamp: Date.now(),
      sessionId,
      node,
      state: this.sanitizeDebugData(state),
      messages: messages.map(msg => this.sanitizeDebugData(msg)),
      variables: this.extractStateVariables(state),
      memory: process.memoryUsage(),
    };

    // Store in state history
    if (!this.stateHistory.has(sessionId)) {
      this.stateHistory.set(sessionId, []);
    }
    
    const history = this.stateHistory.get(sessionId)!;
    history.push(inspection);
    
    // Maintain max history
    if (history.length > 100) {
      history.shift();
    }

    this.captureDebugData('state', 'langraph', inspection, { sessionId, node });
  }

  // Capture tool execution
  captureToolExecution(
    sessionId: string,
    toolName: string,
    input: any,
    output: any,
    duration: number,
    success: boolean,
    error?: string,
    metadata: Record<string, any> = {}
  ): void {
    const toolResult: ToolResult = {
      timestamp: Date.now(),
      sessionId,
      toolName,
      input: this.sanitizeDebugData(input),
      output: this.sanitizeDebugData(output),
      duration,
      success,
      error,
      metadata,
    };

    // Store in tool history
    if (!this.toolHistory.has(sessionId)) {
      this.toolHistory.set(sessionId, []);
    }
    
    const history = this.toolHistory.get(sessionId)!;
    history.push(toolResult);
    
    // Maintain max history
    if (history.length > 1000) {
      history.shift();
    }

    this.captureDebugData('tool', toolName, toolResult, { sessionId, step: 'tool_execution' });
  }

  // Capture prompt/response pairs
  capturePromptResponse(
    sessionId: string,
    model: string,
    prompt: string,
    response: string,
    tokenUsage: PromptCapture['tokenUsage'],
    settings: PromptCapture['settings']
  ): void {
    const capture: PromptCapture = {
      timestamp: Date.now(),
      sessionId,
      model,
      prompt: prompt.length > 10000 ? prompt.substring(0, 10000) + '...' : prompt,
      response: response.length > 10000 ? response.substring(0, 10000) + '...' : response,
      tokenUsage,
      settings,
    };

    // Store in prompt history
    if (!this.promptHistory.has(sessionId)) {
      this.promptHistory.set(sessionId, []);
    }
    
    const history = this.promptHistory.get(sessionId)!;
    history.push(capture);
    
    // Maintain max history
    if (history.length > 100) {
      history.shift();
    }

    this.captureDebugData('prompt', model, capture, { sessionId, step: 'llm_interaction' });
  }

  // Get debug session data
  getDebugSession(sessionId: string): DebugSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  // Get all active debug sessions
  getActiveDebugSessions(): DebugSession[] {
    return Array.from(this.activeSessions.values());
  }

  // Get state history for session
  getStateHistory(sessionId: string): StateInspection[] {
    return this.stateHistory.get(sessionId) || [];
  }

  // Get tool history for session
  getToolHistory(sessionId: string): ToolResult[] {
    return this.toolHistory.get(sessionId) || [];
  }

  // Get prompt history for session
  getPromptHistory(sessionId: string): PromptCapture[] {
    return this.promptHistory.get(sessionId) || [];
  }

  // Get recent debug captures
  getRecentCaptures(limit: number = 100, filters?: DebugFilter[]): DebugCapture[] {
    let captures = this.capturedLogs.slice(-limit);
    
    if (filters) {
      captures = captures.filter(capture => this.matchesFilters(capture, filters));
    }
    
    return captures;
  }

  // Search debug data
  searchDebugData(query: string, options: {
    timeRange?: { start: number; end: number };
    types?: DebugCapture['type'][];
    components?: string[];
    sessionId?: string;
  } = {}): DebugCapture[] {
    let captures = this.capturedLogs;

    // Filter by time range
    if (options.timeRange) {
      captures = captures.filter(c => 
        c.timestamp >= options.timeRange!.start && 
        c.timestamp <= options.timeRange!.end
      );
    }

    // Filter by types
    if (options.types) {
      captures = captures.filter(c => options.types!.includes(c.type));
    }

    // Filter by components
    if (options.components) {
      captures = captures.filter(c => options.components!.includes(c.component));
    }

    // Filter by session
    if (options.sessionId) {
      captures = captures.filter(c => c.context.sessionId === options.sessionId);
    }

    // Search in data
    const queryLower = query.toLowerCase();
    return captures.filter(capture => {
      const dataStr = JSON.stringify(capture.data).toLowerCase();
      const componentStr = capture.component.toLowerCase();
      return dataStr.includes(queryLower) || componentStr.includes(queryLower);
    });
  }

  // Export debug data
  async exportDebugData(sessionId?: string, format: 'json' | 'csv' = 'json'): Promise<string> {
    let data: any;

    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Debug session not found: ${sessionId}`);
      }
      
      data = {
        session,
        stateHistory: this.getStateHistory(sessionId),
        toolHistory: this.getToolHistory(sessionId),
        promptHistory: this.getPromptHistory(sessionId),
      };
    } else {
      data = {
        captures: this.capturedLogs,
        activeSessions: Array.from(this.activeSessions.values()),
        stateHistory: Object.fromEntries(this.stateHistory.entries()),
        toolHistory: Object.fromEntries(this.toolHistory.entries()),
        promptHistory: Object.fromEntries(this.promptHistory.entries()),
      };
    }

    if (format === 'csv') {
      return this.convertToCSV(data);
    }

    return JSON.stringify(data, null, 2);
  }

  // Helper methods
  private startGlobalDebugSession(): void {
    this.startDebugSession({
      mode: 'capture',
      metadata: { global: true },
    });
  }

  private matchesFilters(capture: DebugCapture, filters: DebugFilter[]): boolean {
    if (filters.length === 0) return true;

    return filters.every(filter => {
      let value: string;
      
      switch (filter.type) {
        case 'component':
          value = capture.component;
          break;
        case 'event':
          value = capture.type;
          break;
        case 'user':
          value = capture.context.userId || '';
          break;
        case 'severity':
          value = capture.metadata.severity || '';
          break;
        default:
          return false;
      }

      switch (filter.operator) {
        case 'equals':
          return value === filter.value;
        case 'contains':
          return value.includes(filter.value);
        case 'startsWith':
          return value.startsWith(filter.value);
        case 'regex':
          return new RegExp(filter.value).test(value);
        default:
          return false;
      }
    });
  }

  private sanitizeDebugData(data: any): any {
    if (data === null || data === undefined) return data;
    
    // Handle circular references and large objects
    const seen = new WeakSet();
    
    return JSON.parse(JSON.stringify(data, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      
      // Truncate large strings
      if (typeof value === 'string' && value.length > 5000) {
        return value.substring(0, 5000) + '...';
      }
      
      // Remove sensitive data
      if (key === 'apiKey' || key === 'password' || key === 'token') {
        return '[REDACTED]';
      }
      
      return value;
    }));
  }

  private extractStateVariables(state: any): Record<string, any> {
    const variables: Record<string, any> = {};
    
    if (state && typeof state === 'object') {
      // Extract key variables from state
      for (const [key, value] of Object.entries(state)) {
        if (key !== 'messages' && typeof value !== 'function') {
          variables[key] = this.sanitizeDebugData(value);
        }
      }
    }
    
    return variables;
  }

  private async saveDebugSession(session: DebugSession): Promise<void> {
    try {
      const filename = `debug_session_${session.id}_${Date.now()}.json`;
      const filepath = path.join(this.debugOutputDir, filename);
      
      const data = {
        session,
        stateHistory: this.getStateHistory(session.id),
        toolHistory: this.getToolHistory(session.id),
        promptHistory: this.getPromptHistory(session.id),
      };
      
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      console.log(`🐛 Debug session saved: ${filepath}`);
    } catch (error) {
      console.error('Failed to save debug session:', error);
    }
  }

  private async ensureDebugDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.debugOutputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create debug directory:', error);
    }
  }

  private convertToCSV(data: any): string {
    // Convert debug data to CSV format
    const captures = Array.isArray(data.captures) ? data.captures : data.session?.capturedData || [];
    
    const headers = ['timestamp', 'type', 'component', 'sessionId', 'data'];
    const rows = captures.map((capture: DebugCapture) => [
      new Date(capture.timestamp).toISOString(),
      capture.type,
      capture.component,
      capture.context.sessionId || '',
      JSON.stringify(capture.data).replace(/"/g, '""'),
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
  }

  private setupEventListeners(): void {
    // Listen to metrics events
    metricsCollector.on('research_started', (event) => {
      this.captureDebugData('event', 'metrics', event, { sessionId: event.sessionId });
    });

    metricsCollector.on('research_completed', (event) => {
      this.captureDebugData('event', 'metrics', event, { sessionId: event.sessionId });
    });

    // Listen to error events
    errorTracker.on('error_tracked', (event) => {
      this.captureDebugData('error', 'error_tracker', event, {}, { severity: 'error' });
    });

    errorTracker.on('critical_error', (event) => {
      this.captureDebugData('error', 'error_tracker', event, {}, { severity: 'critical' });
    });
  }

  // Cleanup old data
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
    
    // Clean captured logs
    this.capturedLogs = this.capturedLogs.filter(capture => capture.timestamp > cutoff);
    
    // Clean state history
    for (const [sessionId, history] of this.stateHistory.entries()) {
      const filtered = history.filter(state => state.timestamp > cutoff);
      if (filtered.length === 0) {
        this.stateHistory.delete(sessionId);
      } else {
        this.stateHistory.set(sessionId, filtered);
      }
    }
    
    // Clean tool history
    for (const [sessionId, history] of this.toolHistory.entries()) {
      const filtered = history.filter(tool => tool.timestamp > cutoff);
      if (filtered.length === 0) {
        this.toolHistory.delete(sessionId);
      } else {
        this.toolHistory.set(sessionId, filtered);
      }
    }
    
    // Clean prompt history
    for (const [sessionId, history] of this.promptHistory.entries()) {
      const filtered = history.filter(prompt => prompt.timestamp > cutoff);
      if (filtered.length === 0) {
        this.promptHistory.delete(sessionId);
      } else {
        this.promptHistory.set(sessionId, filtered);
      }
    }
  }
}

// Global debug manager instance
export const debugManager = new DebugManager();

// Debug middleware for Express
export const debugMiddleware = (req: any, res: any, next: any) => {
  if (debugManager['globalDebugMode']) {
    const requestData = {
      method: req.method,
      url: req.url,
      headers: debugManager['sanitizeDebugData'](req.headers),
      body: req.body,
      query: req.query,
      params: req.params,
    };
    
    debugManager.captureDebugData('log', 'express', requestData, {
      userId: req.user?.id,
      sessionId: req.sessionId,
    });
  }
  
  next();
};

// Enhanced research agent with debug integration
export const createDebugEnabledAgent = (originalAgent: any) => {
  return {
    ...originalAgent,
    
    async invoke(input: any, config: any) {
      const sessionId = config?.configurable?.thread_id || 'unknown';
      
      // Start debug session if debug mode is enabled
      let debugSessionId: string | null = null;
      if (debugManager['globalDebugMode']) {
        debugSessionId = await debugManager.startDebugSession({
          mode: 'trace',
          metadata: { researchSession: sessionId },
        });
      }
      
      try {
        // Capture initial state
        debugManager.captureDebugData('state', 'research_agent', {
          input,
          config,
          action: 'start',
        }, { sessionId });
        
        const result = await originalAgent.invoke(input, config);
        
        // Capture final state
        debugManager.captureDebugData('state', 'research_agent', {
          result,
          action: 'complete',
        }, { sessionId });
        
        return result;
      } catch (error) {
        // Capture error
        debugManager.captureDebugData('error', 'research_agent', {
          error: error instanceof Error ? error.message : error,
          input,
          config,
        }, { sessionId });
        
        throw error;
      } finally {
        // End debug session
        if (debugSessionId) {
          await debugManager.endDebugSession(debugSessionId);
        }
      }
    },
  };
};

// Cleanup old debug data every hour
setInterval(() => {
  debugManager.cleanup();
}, 60 * 60 * 1000);

export { DebugSession, DebugFilter, DebugCapture, StateInspection, ToolResult, PromptCapture };