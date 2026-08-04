/**
 * Integration Tests for Complete Research Workflows
 * Tests end-to-end functionality and error recovery scenarios
 */

import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { Server } from 'http';
import request from 'supertest';
import WebSocket from 'ws';
// import { EventEmitter } from 'events';

import { createTestApp } from '../helpers/testApp';
import { TestDatabase } from '../helpers/testDatabase';
import { MockLLMProvider } from '../mocks/MockLLMProvider';
import { MockSearchProvider } from '../mocks/MockSearchProvider';
import { MockVectorStore } from '../mocks/MockVectorStore';
import { TestDataSeeder } from '../helpers/testDataSeeder';

describe('Research Agent E2E Integration Tests', () => {
  let app: Server;
  let testDb: TestDatabase;
  let seeder: TestDataSeeder;
  let baseURL: string;

  beforeAll(async () => {
    // Setup test database
    testDb = new TestDatabase();
    await testDb.setup();
    
    // Create test app with mocked providers
    app = await createTestApp({
      database: testDb.getConnection(),
      providers: {
        llm: new MockLLMProvider(),
        search: new MockSearchProvider(),
        vector: new MockVectorStore()
      }
    });
    
    baseURL = `http://localhost:${app.address()?.port || 3001}`;
    
    // Seed test data
    seeder = new TestDataSeeder(testDb);
    await seeder.seedAll();
  });

  afterAll(async () => {
    await testDb.cleanup();
    app.close();
  });

  beforeEach(async () => {
    await seeder.reset();
  });

  describe('Complete Research Workflow', () => {
    it('should complete successful research from query to final report', async () => {
      const testQuery = 'What are the latest developments in artificial intelligence?';
      
      // Step 1: Start research session
      const startResponse = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'test-user-001',
          sessionOptions: {
            maxSources: 10,
            includeAnalysis: true
          }
        })
        .expect(200);

      expect(startResponse.body).toMatchObject({
        sessionId: expect.any(String),
        status: 'started',
        query: testQuery
      });

      const sessionId = startResponse.body.sessionId;

      // Step 2: Monitor progress through SSE
      const progressEvents = await new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        const ws = new WebSocket(`${baseURL.replace('http', 'ws')}/api/research/${sessionId}/stream`);
        
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Research workflow timeout'));
        }, 30000);

        ws.on('message', (data) => {
          const event = JSON.parse(data.toString());
          events.push(event);
          
          // Complete when we receive final report
          if (event.type === 'research_complete') {
            clearTimeout(timeout);
            ws.close();
            resolve(events);
          }
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Validate progress events
      const eventTypes = progressEvents.map(e => e.type);
      expect(eventTypes).toContain('state_change');
      expect(eventTypes).toContain('tool_execution');
      expect(eventTypes).toContain('sources_found');
      expect(eventTypes).toContain('analysis_complete');
      expect(eventTypes).toContain('research_complete');

      // Step 3: Verify final result
      const resultResponse = await request(app)
        .get(`/api/research/${sessionId}`)
        .expect(200);

      expect(resultResponse.body).toMatchObject({
        sessionId,
        status: 'completed',
        query: testQuery,
        sources: expect.arrayContaining([
          expect.objectContaining({
            type: expect.stringMatching(/search|vector/),
            title: expect.any(String),
            content: expect.any(String),
            score: expect.any(Number)
          })
        ]),
        analysis: expect.any(String),
        report: expect.stringContaining('# Research Report'),
        duration: expect.any(Number),
        tokensUsed: expect.any(Number),
        cost: expect.any(Number)
      });

      // Validate report structure
      const report = resultResponse.body.report;
      expect(report).toContain('# Research Report');
      expect(report).toContain('## Key Findings');
      expect(report).toContain('## Sources');
      expect(report).toContain('## Analysis');

      // Step 4: Verify database persistence
      const session = await testDb.query(
        'SELECT * FROM research_sessions WHERE session_id = $1',
        [sessionId]
      );
      
      expect(session.rows).toHaveLength(1);
      expect(session.rows[0]).toMatchObject({
        session_id: sessionId,
        user_id: 'test-user-001',
        query: testQuery,
        status: 'completed',
        sources_count: expect.any(Number),
        tokens_used: expect.any(Number),
        cost: expect.stringMatching(/^\d+\.\d+$/)
      });
    }, 35000);

    it('should handle streaming research with real-time updates', async () => {
      const testQuery = 'Explain quantum computing developments';
      
      // Start streaming research
      const streamResponse = await request(app)
        .post('/api/research/stream')
        .send({
          query: testQuery,
          userId: 'test-user-002',
          stream: true
        })
        .expect(200);

      const sessionId = streamResponse.body.sessionId;
      
      // Connect to SSE stream
      const streamEvents = await new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        // SSE connection handler
        
        // Use node-fetch for SSE in test environment
        const fetchSSE = async () => {
          const response = await fetch(`${baseURL}/api/research/${sessionId}/events`, {
            headers: { 'Accept': 'text/event-stream' }
          });
          
          if (!response.body) throw new Error('No response body');
          
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const event = JSON.parse(line.slice(6));
                  events.push(event);
                  
                  if (event.type === 'research_complete') {
                    resolve(events);
                    return;
                  }
                } catch {
                  // Ignore parsing errors for heartbeat messages
                }
              }
            }
          }
        };

        fetchSSE().catch(reject);
        
        setTimeout(() => reject(new Error('SSE timeout')), 25000);
      });

      // Validate streaming events
      expect(streamEvents.length).toBeGreaterThan(5);
      
      const stateChanges = streamEvents.filter(e => e.type === 'state_change');
      expect(stateChanges.length).toBeGreaterThan(2);
      
      const toolExecutions = streamEvents.filter(e => e.type === 'tool_execution');
      expect(toolExecutions.length).toBeGreaterThan(0);
      
      const finalEvent = streamEvents[streamEvents.length - 1];
      expect(finalEvent.type).toBe('research_complete');
      expect(finalEvent.data.report).toContain('quantum computing');
    }, 30000);

    it('should handle concurrent research sessions', async () => {
      const queries = [
        'What is machine learning?',
        'How does blockchain work?',
        'Explain renewable energy trends'
      ];

      // Start multiple concurrent sessions
      const sessionPromises = queries.map((query, index) => 
        request(app)
          .post('/api/research')
          .send({
            query,
            userId: `concurrent-user-${index}`,
            sessionOptions: { maxSources: 5 }
          })
          .expect(200)
      );

      const startResponses = await Promise.all(sessionPromises);
      const sessionIds = startResponses.map(r => r.body.sessionId);

      // Wait for all sessions to complete
      const resultPromises = sessionIds.map(sessionId => 
        new Promise<any>((resolve, reject) => {
          const checkCompletion = async () => {
            try {
              const response = await request(app)
                .get(`/api/research/${sessionId}`)
                .expect(200);
              
              if (response.body.status === 'completed') {
                resolve(response.body);
              } else if (response.body.status === 'error') {
                reject(new Error(`Session ${sessionId} failed`));
              } else {
                setTimeout(checkCompletion, 1000);
              }
            } catch (error) {
              reject(error);
            }
          };
          
          checkCompletion();
          setTimeout(() => reject(new Error('Session timeout')), 25000);
        })
      );

      const results = await Promise.all(resultPromises);

      // Validate all sessions completed successfully
      results.forEach((result, index) => {
        expect(result.status).toBe('completed');
        expect(result.query).toBe(queries[index]);
        expect(result.sources.length).toBeGreaterThan(0);
        expect(result.analysis).toBeTruthy();
      });

      // Verify sessions didn't interfere with each other
      const uniqueReports = new Set(results.map(r => r.report));
      expect(uniqueReports.size).toBe(3);
    }, 35000);
  });

  describe('Error Recovery Scenarios', () => {
    it('should recover from OpenAI API failures', async () => {
      // Configure mock to fail initially then succeed
      const mockLLM = app.get('providers').llm;
      let callCount = 0;
      
      const originalCall = mockLLM.generateResponse;
      mockLLM.generateResponse = jest.fn().mockImplementation(async (...args) => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('OpenAI API temporarily unavailable');
        }
        return originalCall.apply(mockLLM, args);
      });

      const testQuery = 'Test error recovery';
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'error-recovery-user',
          sessionOptions: { retryAttempts: 3 }
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Wait for completion or failure
      const result = await new Promise<any>((resolve, reject) => {
        const checkStatus = async () => {
          try {
            const statusResponse = await request(app)
              .get(`/api/research/${sessionId}`)
              .expect(200);
            
            if (statusResponse.body.status === 'completed') {
              resolve(statusResponse.body);
            } else if (statusResponse.body.status === 'error') {
              reject(new Error('Session failed to recover'));
            } else {
              setTimeout(checkStatus, 1000);
            }
          } catch (error) {
            reject(error);
          }
        };
        
        checkStatus();
        setTimeout(() => reject(new Error('Recovery timeout')), 20000);
      });

      expect(result.status).toBe('completed');
      expect(mockLLM.generateResponse).toHaveBeenCalledTimes(3);
    }, 25000);

    it('should handle search provider timeouts gracefully', async () => {
      // Configure search to timeout
      const mockSearch = app.get('providers').search;
      mockSearch.setGlobalDelay(15000); // 15 second delay (exceeds timeout)

      const testQuery = 'Test search timeout recovery';
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'timeout-recovery-user',
          sessionOptions: { 
            searchTimeout: 5000,
            fallbackToVector: true 
          }
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Monitor for timeout and recovery
      const events = await new Promise<any[]>((resolve, reject) => {
        const collectedEvents: any[] = [];
        const ws = new WebSocket(`${baseURL.replace('http', 'ws')}/api/research/${sessionId}/stream`);
        
        ws.on('message', (data) => {
          const event = JSON.parse(data.toString());
          collectedEvents.push(event);
          
          if (event.type === 'research_complete' || event.type === 'error') {
            ws.close();
            resolve(collectedEvents);
          }
        });

        setTimeout(() => {
          ws.close();
          reject(new Error('Event collection timeout'));
        }, 20000);
      });

      // Should have timeout event and recovery
      const timeoutEvent = events.find(e => e.type === 'tool_error' && e.data.error.includes('timeout'));
      expect(timeoutEvent).toBeTruthy();

      const recoveryEvent = events.find(e => e.type === 'fallback_activated');
      expect(recoveryEvent).toBeTruthy();

      // Should complete with vector-only results
      const completionEvent = events.find(e => e.type === 'research_complete');
      expect(completionEvent).toBeTruthy();
    }, 25000);

    it('should handle database connection failures', async () => {
      // Temporarily close database connection
      await testDb.simulateConnectionFailure();

      const testQuery = 'Test database failure recovery';
      
      // Should return error but not crash
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'db-failure-user'
        })
        .expect(500);

      expect(response.body.error).toContain('database');

      // Restore connection
      await testDb.restoreConnection();

      // Should work again
      const retryResponse = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'db-recovery-user'
        })
        .expect(200);

      expect(retryResponse.body.sessionId).toBeTruthy();
    });

    it('should handle malformed requests gracefully', async () => {
      const malformedRequests = [
        { /* missing query */ },
        { query: '' },
        { query: 'test', userId: null },
        { query: 'test', sessionOptions: 'invalid' },
        { query: 'a'.repeat(10000) } // extremely long query
      ];

      for (const request_body of malformedRequests) {
        const response = await request(app)
          .post('/api/research')
          .send(request_body)
          .expect(400);

        expect(response.body.error).toBeTruthy();
        expect(response.body.code).toMatch(/INVALID_|MISSING_/);
      }
    });
  });

  describe('Concurrent Session Handling', () => {
    it('should handle high concurrent load', async () => {
      const concurrentUsers = 20;
      const sessionsPerUser = 2;

      const allPromises: Promise<any>[] = [];

      // Create multiple users with multiple sessions each
      for (let user = 0; user < concurrentUsers; user++) {
        for (let session = 0; session < sessionsPerUser; session++) {
          const promise = request(app)
            .post('/api/research')
            .send({
              query: `Concurrent test query ${user}-${session}`,
              userId: `load-test-user-${user}`
            })
            .expect(200);
          
          allPromises.push(promise);
        }
      }

      const responses = await Promise.all(allPromises);
      
      // All should start successfully
      expect(responses).toHaveLength(concurrentUsers * sessionsPerUser);
      responses.forEach(response => {
        expect(response.body.sessionId).toBeTruthy();
        expect(response.body.status).toBe('started');
      });

      // Check system health during load
      const healthResponse = await request(app)
        .get('/api/health')
        .expect(200);

      expect(healthResponse.body.status).toBe('healthy');
      expect(healthResponse.body.activeSessions).toBe(concurrentUsers * sessionsPerUser);
    }, 30000);

    it('should enforce rate limits per user', async () => {
      const userId = 'rate-limit-test-user';
      const rateLimitPromises: Promise<any>[] = [];

      // Make requests quickly to trigger rate limit
      for (let i = 0; i < 10; i++) {
        rateLimitPromises.push(
          request(app)
            .post('/api/research')
            .send({
              query: `Rate limit test ${i}`,
              userId
            })
        );
      }

      const responses = await Promise.allSettled(rateLimitPromises);
      
      const successful = responses.filter(r => r.status === 'fulfilled' && r.value.status === 200);
      const rateLimited = responses.filter(r => r.status === 'fulfilled' && r.value.status === 429);

      expect(successful.length).toBeLessThan(10);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Memory Persistence', () => {
    it('should persist session state across server restarts', async () => {
      const testQuery = 'Persistence test query';
      
      // Start a session
      const startResponse = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'persistence-test-user'
        })
        .expect(200);

      const sessionId = startResponse.body.sessionId;

      // Wait for some progress
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get current state
      const preRestartResponse = await request(app)
        .get(`/api/research/${sessionId}`)
        .expect(200);

      // Simulate server restart by recreating app
      app.close();
      app = await createTestApp({
        database: testDb.getConnection(),
        providers: {
          llm: new MockLLMProvider(),
          search: new MockSearchProvider(),
          vector: new MockVectorStore()
        }
      });

      // Session should be recoverable
      const postRestartResponse = await request(app)
        .get(`/api/research/${sessionId}`)
        .expect(200);

      expect(postRestartResponse.body.sessionId).toBe(sessionId);
      expect(postRestartResponse.body.query).toBe(testQuery);
      
      // Should be able to resume if not completed
      if (preRestartResponse.body.status !== 'completed') {
        const resumeResponse = await request(app)
          .post(`/api/research/${sessionId}/resume`)
          .expect(200);

        expect(resumeResponse.body.resumed).toBe(true);
      }
    });

    it('should maintain conversation history', async () => {
      const testQuery = 'History test query';
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'history-test-user'
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        const checkCompletion = async () => {
          try {
            const statusResponse = await request(app)
              .get(`/api/research/${sessionId}`)
              .expect(200);
            
            if (statusResponse.body.status === 'completed') {
              resolve();
            } else {
              setTimeout(checkCompletion, 1000);
            }
          } catch (error) {
            reject(error);
          }
        };
        
        checkCompletion();
        setTimeout(() => reject(new Error('Completion timeout')), 20000);
      });

      // Get conversation history
      const historyResponse = await request(app)
        .get(`/api/research/${sessionId}/history`)
        .expect(200);

      expect(historyResponse.body.messages).toBeInstanceOf(Array);
      expect(historyResponse.body.messages.length).toBeGreaterThan(2);
      
      // Should have user message, assistant responses, and tool calls
      const messageTypes = historyResponse.body.messages.map((m: any) => m.role);
      expect(messageTypes).toContain('user');
      expect(messageTypes).toContain('assistant');
      expect(messageTypes).toContain('tool');
    }, 25000);
  });

  describe('SSE Connection Lifecycle', () => {
    it('should handle SSE connection drops and reconnection', async () => {
      const testQuery = 'SSE lifecycle test';
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'sse-test-user'
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Connect to SSE
      let ws = new WebSocket(`${baseURL.replace('http', 'ws')}/api/research/${sessionId}/stream`);
      
      const firstConnectionEvents = await new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        
        ws.on('message', (data) => {
          const event = JSON.parse(data.toString());
          events.push(event);
          
          // Close connection after receiving some events
          if (events.length >= 3) {
            ws.close();
            resolve(events);
          }
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('First connection timeout')), 10000);
      });

      expect(firstConnectionEvents.length).toBeGreaterThanOrEqual(3);

      // Reconnect and continue receiving events
      ws = new WebSocket(`${baseURL.replace('http', 'ws')}/api/research/${sessionId}/stream`);
      
      const secondConnectionEvents = await new Promise<any[]>((resolve, reject) => {
        const events: any[] = [];
        
        ws.on('message', (data) => {
          const event = JSON.parse(data.toString());
          events.push(event);
          
          if (event.type === 'research_complete') {
            ws.close();
            resolve(events);
          }
        });

        ws.on('error', reject);
        setTimeout(() => reject(new Error('Second connection timeout')), 15000);
      });

      // Should receive remaining events including completion
      expect(secondConnectionEvents.length).toBeGreaterThan(0);
      expect(secondConnectionEvents[secondConnectionEvents.length - 1].type).toBe('research_complete');
    }, 30000);

    it('should handle multiple SSE connections for same session', async () => {
      const testQuery = 'Multiple SSE test';
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: testQuery,
          userId: 'multi-sse-user'
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Connect multiple WebSocket clients
      const connectionPromises = Array.from({ length: 3 }, (_, index) => 
        new Promise<any[]>((resolve, reject) => {
          const events: any[] = [];
          const ws = new WebSocket(`${baseURL.replace('http', 'ws')}/api/research/${sessionId}/stream`);
          
          ws.on('message', (data) => {
            const event = JSON.parse(data.toString());
            events.push(event);
            
            if (event.type === 'research_complete') {
              ws.close();
              resolve(events);
            }
          });

          ws.on('error', reject);
          setTimeout(() => {
            ws.close();
            reject(new Error(`Connection ${index} timeout`));
          }, 20000);
        })
      );

      const allConnectionEvents = await Promise.all(connectionPromises);

      // All connections should receive the same events
      allConnectionEvents.forEach((events) => {
        expect(events.length).toBeGreaterThan(0);
        expect(events[events.length - 1].type).toBe('research_complete');
      });

      // Event counts should be similar (allowing for timing differences)
      const eventCounts = allConnectionEvents.map(events => events.length);
      const minCount = Math.min(...eventCounts);
      const maxCount = Math.max(...eventCounts);
      expect(maxCount - minCount).toBeLessThanOrEqual(2);
    }, 25000);
  });

  describe('Performance Benchmarks', () => {
    it('should complete simple queries within 10 seconds', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .post('/api/research')
        .send({
          query: 'What is machine learning?',
          userId: 'performance-test-user',
          sessionOptions: { maxSources: 3 }
        })
        .expect(200);

      const sessionId = response.body.sessionId;

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        const checkCompletion = async () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > 12000) {
            reject(new Error('Performance test timeout'));
            return;
          }

          try {
            const statusResponse = await request(app)
              .get(`/api/research/${sessionId}`)
              .expect(200);
            
            if (statusResponse.body.status === 'completed') {
              resolve();
            } else {
              setTimeout(checkCompletion, 500);
            }
          } catch (error) {
            reject(error);
          }
        };
        
        checkCompletion();
      });

      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeLessThan(10000); // 10 seconds
    }, 15000);

    it('should handle memory efficiently for long-running sessions', async () => {
      const initialMemory = process.memoryUsage();
      
      // Run multiple sessions
      const sessionPromises = Array.from({ length: 5 }, (_, index) =>
        request(app)
          .post('/api/research')
          .send({
            query: `Memory test query ${index}`,
            userId: `memory-test-user-${index}`
          })
          .expect(200)
      );

      const responses = await Promise.all(sessionPromises);
      const sessionIds = responses.map(r => r.body.sessionId);

      // Wait for all to complete
      await Promise.all(sessionIds.map(sessionId =>
        new Promise<void>((resolve, reject) => {
          const checkCompletion = async () => {
            try {
              const statusResponse = await request(app)
                .get(`/api/research/${sessionId}`)
                .expect(200);
              
              if (statusResponse.body.status === 'completed' || statusResponse.body.status === 'error') {
                resolve();
              } else {
                setTimeout(checkCompletion, 1000);
              }
            } catch (error) {
              reject(error);
            }
          };
          
          checkCompletion();
          setTimeout(() => reject(new Error('Memory test timeout')), 25000);
        })
      ));

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // Memory increase should be reasonable (less than 100MB)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    }, 35000);
  });
});