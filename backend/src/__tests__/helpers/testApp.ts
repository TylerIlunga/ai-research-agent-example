/**
 * Test Application Factory
 * Creates test instances of the Express application with mocked dependencies
 */

import express from 'express';
import cors from 'cors';
import { Server } from 'http';
import { MockLLMProvider } from '../mocks/MockLLMProvider';
import { MockSearchProvider } from '../mocks/MockSearchProvider';
import { MockVectorStore } from '../mocks/MockVectorStore';

export interface TestAppConfig {
  database?: any;
  providers?: {
    llm?: MockLLMProvider;
    search?: MockSearchProvider;
    vector?: MockVectorStore;
  };
  port?: number;
}

export interface TestAppContext {
  app: express.Application;
  server: Server;
  providers: {
    llm: MockLLMProvider;
    search: MockSearchProvider;
    vector: MockVectorStore;
  };
  database: any;
}

/**
 * Create a test application instance
 */
export async function createTestApp(config: TestAppConfig = {}): Promise<Server> {
  const app = express();
  const port = config.port || 0; // Use random port for testing

  // Setup providers
  const providers = {
    llm: config.providers?.llm || new MockLLMProvider(),
    search: config.providers?.search || new MockSearchProvider(),
    vector: config.providers?.vector || new MockVectorStore()
  };

  // Store providers and database in app for access in tests
  app.set('providers', providers);
  app.set('database', config.database);

  // Basic middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeSessions: 0 // Mock value
    });
  });

  // Mock research endpoints
  app.post('/api/research', async (req, res) => {
    try {
      const { query, userId } = req.body;

      // Validate request
      if (!query || typeof query !== 'string') {
        return res.status(400).json({
          error: 'Invalid query',
          code: 'INVALID_QUERY'
        });
      }

      if (!userId) {
        return res.status(400).json({
          error: 'Missing user ID',
          code: 'MISSING_USER_ID'
        });
      }

      // Generate session ID
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Mock successful response
      res.json({
        sessionId,
        status: 'started',
        query,
        userId,
        timestamp: new Date().toISOString()
      });

      // Simulate async processing
      setTimeout(() => {
        // Mark session as completed (would be handled by SSE in real app)
        console.log(`Session ${sessionId} completed`);
      }, Math.random() * 2000 + 1000); // 1-3 seconds

    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  });

  app.get('/api/research/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Mock session status based on sessionId
      const status = sessionId.includes('error') ? 'error' : 
                   sessionId.includes('processing') ? 'processing' : 'completed';

      const response: any = {
        sessionId,
        status,
        query: 'Mock research query',
        timestamp: new Date().toISOString()
      };

      if (status === 'completed') {
        response.sources = [
          {
            url: 'https://example.com/source1',
            title: 'Mock Source 1',
            content: 'Mock content 1',
            score: 0.95,
            type: 'search'
          }
        ];
        response.analysis = 'Mock analysis of the research query.';
        response.report = '# Mock Research Report\n\nThis is a mock research report.';
        response.duration = 2500;
        response.tokensUsed = 1500;
        response.cost = 0.075;
      } else if (status === 'error') {
        response.error = 'Mock error message';
      }

      res.json(response);

    } catch (error) {
      res.status(500).json({
        error: 'Failed to get session status',
        message: error.message
      });
    }
  });

  // Mock SSE endpoint
  app.get('/api/research/:sessionId/stream', (req, res) => {
    const { sessionId } = req.params;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send mock events
    const events = [
      { type: 'state_change', data: { from: 'idle', to: 'analyzing' } },
      { type: 'tool_execution', data: { tool: 'tavily_search', status: 'running' } },
      { type: 'sources_found', data: { count: 3 } },
      { type: 'analysis_complete', data: { status: 'success' } },
      { type: 'research_complete', data: { sessionId, status: 'completed' } }
    ];

    let eventIndex = 0;
    const sendEvent = () => {
      if (eventIndex < events.length) {
        const event = events[eventIndex];
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        eventIndex++;
        setTimeout(sendEvent, 500); // Send event every 500ms
      } else {
        res.end();
      }
    };

    sendEvent();

    req.on('close', () => {
      res.end();
    });
  });

  // Mock WebSocket endpoint for testing
  app.get('/api/research/:sessionId/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Simulate SSE events
    let eventCount = 0;
    const interval = setInterval(() => {
      eventCount++;
      
      if (eventCount <= 5) {
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          data: { step: eventCount, total: 5 }
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({
          type: 'research_complete',
          data: { sessionId: req.params.sessionId }
        })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    }, 200);

    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  });

  // Mock resume endpoint
  app.post('/api/research/:sessionId/resume', (req, res) => {
    const { sessionId } = req.params;
    
    res.json({
      sessionId,
      resumed: true,
      status: 'processing',
      timestamp: new Date().toISOString()
    });
  });

  // Mock history endpoint
  app.get('/api/research/:sessionId/history', (req, res) => {
    res.json({
      sessionId: req.params.sessionId,
      messages: [
        {
          role: 'user',
          content: 'Test query',
          timestamp: new Date().toISOString()
        },
        {
          role: 'assistant',
          content: 'I need to search for information.',
          timestamp: new Date().toISOString()
        },
        {
          role: 'tool',
          content: JSON.stringify({ results: ['mock results'] }),
          timestamp: new Date().toISOString()
        }
      ]
    });
  });

  // Mock metrics endpoint
  app.get('/api/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(`
# HELP ai_research_agent_requests_total Total number of requests
# TYPE ai_research_agent_requests_total counter
ai_research_agent_requests_total 100

# HELP ai_research_agent_response_duration_seconds Request duration
# TYPE ai_research_agent_response_duration_seconds histogram
ai_research_agent_response_duration_seconds_bucket{le="0.1"} 10
ai_research_agent_response_duration_seconds_bucket{le="0.5"} 50
ai_research_agent_response_duration_seconds_bucket{le="1.0"} 80
ai_research_agent_response_duration_seconds_bucket{le="+Inf"} 100
ai_research_agent_response_duration_seconds_sum 45.0
ai_research_agent_response_duration_seconds_count 100
    `.trim());
  });

  // Mock debug endpoint
  app.get('/api/debug', (req, res) => {
    res.json({
      status: 'debug',
      environment: 'test',
      providers: {
        llm: 'MockLLMProvider',
        search: 'MockSearchProvider',
        vector: 'MockVectorStore'
      },
      database: config.database ? 'connected' : 'mock',
      timestamp: new Date().toISOString()
    });
  });

  // Error handling middleware
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Test app error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      code: 'INTERNAL_ERROR'
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
      code: 'NOT_FOUND'
    });
  });

  // Start server
  return new Promise((resolve, reject) => {
    const server = app.listen(port, (err?: any) => {
      if (err) {
        reject(err);
      } else {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`Test server running on port ${actualPort}`);
        resolve(server);
      }
    });
  });
}

/**
 * Create test application with WebSocket support
 */
export async function createTestAppWithWebSocket(config: TestAppConfig = {}): Promise<TestAppContext> {
  const server = await createTestApp(config);
  const app = server as any; // Cast for TypeScript

  return {
    app: app._events?.request || app,
    server,
    providers: app.get('providers'),
    database: app.get('database')
  };
}

/**
 * Cleanup test application
 */
export async function cleanupTestApp(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}