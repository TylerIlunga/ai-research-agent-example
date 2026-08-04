/**
 * Unit Tests for Research Agent State Transitions
 * Target Coverage: 95%
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ResearchAgent, AgentState } from '../../agents/researchAgent';
import { MockLLMProvider } from '../mocks/MockLLMProvider';
import { MockSearchProvider } from '../mocks/MockSearchProvider';
import { MockVectorStore } from '../mocks/MockVectorStore';

// Mock implementations
jest.mock('../../providers/openai', () => ({
  OpenAIProvider: jest.fn().mockImplementation(() => new MockLLMProvider())
}));

jest.mock('../../providers/tavily', () => ({
  TavilyProvider: jest.fn().mockImplementation(() => new MockSearchProvider())
}));

jest.mock('../../providers/pinecone', () => ({
  PineconeProvider: jest.fn().mockImplementation(() => new MockVectorStore())
}));

describe('ResearchAgent State Transitions', () => {
  let agent: ResearchAgent;
  let mockLLM: MockLLMProvider;
  let mockSearch: MockSearchProvider;
  let mockVector: MockVectorStore;

  beforeEach(() => {
    mockLLM = new MockLLMProvider();
    mockSearch = new MockSearchProvider();
    mockVector = new MockVectorStore();
    
    agent = new ResearchAgent({
      llmProvider: mockLLM,
      searchProvider: mockSearch,
      vectorStore: mockVector,
      sessionId: 'test-session-001'
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with IDLE state', () => {
      expect(agent.getState()).toBe(AgentState.IDLE);
      expect(agent.getSessionId()).toBe('test-session-001');
      expect(agent.getContext()).toEqual({
        query: '',
        sources: [],
        analysis: '',
        report: '',
        metadata: {}
      });
    });

    it('should have empty message history', () => {
      expect(agent.getMessages()).toHaveLength(0);
    });

    it('should have no active tools', () => {
      expect(agent.getActiveTools()).toHaveLength(0);
    });
  });

  describe('State Transition: IDLE -> ANALYZING', () => {
    it('should transition to ANALYZING when starting research', async () => {
      const query = 'What are the latest developments in AI?';
      
      const transitionPromise = agent.startResearch(query);
      
      expect(agent.getState()).toBe(AgentState.ANALYZING);
      expect(agent.getContext().query).toBe(query);
      
      await transitionPromise;
    });

    it('should reject multiple concurrent research starts', async () => {
      const query1 = 'Query 1';
      const query2 = 'Query 2';
      
      const promise1 = agent.startResearch(query1);
      
      await expect(agent.startResearch(query2)).rejects.toThrow(
        'Agent is already processing a research task'
      );
      
      await promise1;
    });

    it('should emit state change events', async () => {
      const stateChangeSpy = jest.fn();
      agent.on('stateChange', stateChangeSpy);
      
      await agent.startResearch('Test query');
      
      expect(stateChangeSpy).toHaveBeenCalledWith({
        from: AgentState.IDLE,
        to: AgentState.ANALYZING,
        timestamp: expect.any(Number),
        context: expect.any(Object)
      });
    });
  });

  describe('State Transition: ANALYZING -> SEARCHING', () => {
    beforeEach(async () => {
      await agent.startResearch('Test query for search');
    });

    it('should transition to SEARCHING after analysis', async () => {
      mockLLM.setNextResponse({
        content: 'Based on the query, I need to search for recent AI developments.',
        toolCalls: [
          {
            name: 'tavily_search',
            args: { query: 'latest AI developments 2024' }
          }
        ]
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.SEARCHING);
      expect(mockSearch.search).toHaveBeenCalledWith({
        query: 'latest AI developments 2024',
        maxResults: expect.any(Number)
      });
    });

    it('should handle search tool with multiple queries', async () => {
      mockLLM.setNextResponse({
        content: 'I need to search multiple aspects.',
        toolCalls: [
          {
            name: 'tavily_search',
            args: { query: 'AI developments 2024' }
          },
          {
            name: 'tavily_search', 
            args: { query: 'machine learning breakthroughs' }
          }
        ]
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.SEARCHING);
      expect(mockSearch.search).toHaveBeenCalledTimes(2);
    });

    it('should handle search errors gracefully', async () => {
      mockLLM.setNextResponse({
        content: 'Searching for information.',
        toolCalls: [
          {
            name: 'tavily_search',
            args: { query: 'test query' }
          }
        ]
      });

      mockSearch.setError(new Error('Search API unavailable'));

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('Search API unavailable');
    });
  });

  describe('State Transition: SEARCHING -> RETRIEVING', () => {
    beforeEach(async () => {
      await agent.startResearch('Test query');
      mockLLM.setNextResponse({
        content: 'Searching for information.',
        toolCalls: [
          {
            name: 'tavily_search',
            args: { query: 'test search' }
          }
        ]
      });
      await agent.processNextStep(); // ANALYZING -> SEARCHING
    });

    it('should transition to RETRIEVING after search completion', async () => {
      mockSearch.setSearchResults([
        {
          title: 'AI Development Article',
          content: 'Latest AI developments include...',
          url: 'https://example.com/ai-dev',
          score: 0.95
        }
      ]);

      mockLLM.setNextResponse({
        content: 'Now I need to retrieve more specific information.',
        toolCalls: [
          {
            name: 'pinecone_query',
            args: { query: 'AI developments', topK: 5 }
          }
        ]
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.RETRIEVING);
      expect(agent.getContext().sources).toHaveLength(1);
      expect(mockVector.query).toHaveBeenCalledWith(
        expect.any(Array), // embedding vector
        { topK: 5, filter: expect.any(Object) }
      );
    });

    it('should skip RETRIEVING if no vector query needed', async () => {
      mockSearch.setSearchResults([
        {
          title: 'Complete Answer',
          content: 'This contains all needed information.',
          url: 'https://example.com/complete',
          score: 0.98
        }
      ]);

      mockLLM.setNextResponse({
        content: 'I have sufficient information to provide an analysis.',
        toolCalls: [] // No tool calls
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.SYNTHESIZING);
    });
  });

  describe('State Transition: RETRIEVING -> SYNTHESIZING', () => {
    beforeEach(async () => {
      // Set up agent in RETRIEVING state
      await agent.startResearch('Test query');
      
      // Transition through states
      mockLLM.setNextResponse({
        toolCalls: [{ name: 'tavily_search', args: { query: 'test' } }]
      });
      await agent.processNextStep(); // -> SEARCHING
      
      mockLLM.setNextResponse({
        toolCalls: [{ name: 'pinecone_query', args: { query: 'test' } }]
      });
      await agent.processNextStep(); // -> RETRIEVING
    });

    it('should transition to SYNTHESIZING after retrieval', async () => {
      mockVector.setQueryResults([
        {
          id: 'doc-1',
          score: 0.92,
          metadata: {
            title: 'Vector Document 1',
            content: 'Additional context from vector store'
          }
        }
      ]);

      mockLLM.setNextResponse({
        content: 'Now I will synthesize all the information.',
        toolCalls: [] // No more tools needed
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.SYNTHESIZING);
      expect(agent.getContext().sources).toContainEqual(
        expect.objectContaining({
          type: 'vector',
          title: 'Vector Document 1'
        })
      );
    });

    it('should handle vector store errors', async () => {
      mockVector.setError(new Error('Vector store connection failed'));

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('Vector store connection failed');
    });
  });

  describe('State Transition: SYNTHESIZING -> COMPLETE', () => {
    beforeEach(async () => {
      // Set up agent in SYNTHESIZING state with sources
      await agent.startResearch('Test query');
      agent.setState(AgentState.SYNTHESIZING);
      agent.updateContext({
        sources: [
          {
            type: 'search',
            title: 'Search Result 1',
            content: 'Search content',
            url: 'https://example.com/1',
            score: 0.95
          },
          {
            type: 'vector',
            title: 'Vector Result 1',
            content: 'Vector content',
            score: 0.88
          }
        ]
      });
    });

    it('should complete research with comprehensive analysis', async () => {
      const expectedAnalysis = 'Based on my research, here are the key findings...';
      
      mockLLM.setNextResponse({
        content: expectedAnalysis,
        toolCalls: []
      });

      await agent.processNextStep();
      
      expect(agent.getState()).toBe(AgentState.COMPLETE);
      expect(agent.getContext().analysis).toBe(expectedAnalysis);
      expect(agent.getContext().report).toContain('Research Summary');
    });

    it('should generate structured report', async () => {
      mockLLM.setNextResponse({
        content: 'Analysis complete.',
        toolCalls: []
      });

      await agent.processNextStep();
      
      const report = agent.getContext().report;
      expect(report).toContain('# Research Report');
      expect(report).toContain('## Key Findings');
      expect(report).toContain('## Sources');
      expect(report).toContain('## Analysis');
    });

    it('should emit completion event', async () => {
      const completionSpy = jest.fn();
      agent.on('researchComplete', completionSpy);
      
      mockLLM.setNextResponse({
        content: 'Research completed.',
        toolCalls: []
      });

      await agent.processNextStep();
      
      expect(completionSpy).toHaveBeenCalledWith({
        sessionId: 'test-session-001',
        query: 'Test query',
        sources: expect.any(Array),
        analysis: expect.any(String),
        report: expect.any(String),
        duration: expect.any(Number)
      });
    });
  });

  describe('Error Handling', () => {
    it('should transition to ERROR state on LLM failure', async () => {
      mockLLM.setError(new Error('OpenAI API timeout'));
      
      await agent.startResearch('Test query');
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('OpenAI API timeout');
    });

    it('should recover from ERROR state', async () => {
      // Force error state
      agent.setState(AgentState.ERROR);
      agent.updateContext({ error: 'Previous error' });
      
      const recoveryResult = await agent.recover();
      
      expect(recoveryResult.success).toBe(true);
      expect(agent.getState()).toBe(AgentState.IDLE);
      expect(agent.getContext().error).toBeUndefined();
    });

    it('should handle recovery failures', async () => {
      agent.setState(AgentState.ERROR);
      agent.updateContext({ error: 'Critical system failure' });
      
      // Mock recovery failure
      mockLLM.setError(new Error('Still failing'));
      
      const recoveryResult = await agent.recover();
      
      expect(recoveryResult.success).toBe(false);
      expect(agent.getState()).toBe(AgentState.ERROR);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running operations', async () => {
      // Mock slow search
      mockSearch.setDelay(10000); // 10 seconds
      
      mockLLM.setNextResponse({
        toolCalls: [{ name: 'tavily_search', args: { query: 'test' } }]
      });

      await agent.startResearch('Test query');
      
      // Should timeout after 5 seconds (configured timeout)
      await new Promise(resolve => setTimeout(resolve, 6000));
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('timeout');
    }, 7000);

    it('should handle custom timeouts', async () => {
      agent.setOperationTimeout(1000); // 1 second
      
      mockSearch.setDelay(2000); // 2 seconds
      mockLLM.setNextResponse({
        toolCalls: [{ name: 'tavily_search', args: { query: 'test' } }]
      });

      await agent.startResearch('Test query');
      
      expect(agent.getState()).toBe(AgentState.ERROR);
    });
  });

  describe('Memory Management', () => {
    it('should maintain conversation history', async () => {
      await agent.startResearch('First query');
      
      const initialMessages = agent.getMessages();
      expect(initialMessages).toHaveLength(2); // System + user message
      
      mockLLM.setNextResponse({ content: 'Response 1', toolCalls: [] });
      await agent.processNextStep();
      
      const afterResponse = agent.getMessages();
      expect(afterResponse).toHaveLength(3); // + assistant message
    });

    it('should clear context on reset', async () => {
      await agent.startResearch('Test query');
      agent.updateContext({ analysis: 'Some analysis' });
      
      agent.reset();
      
      expect(agent.getState()).toBe(AgentState.IDLE);
      expect(agent.getContext()).toEqual({
        query: '',
        sources: [],
        analysis: '',
        report: '',
        metadata: {}
      });
      expect(agent.getMessages()).toHaveLength(0);
    });

    it('should persist state to storage', async () => {
      const mockStorage = {
        save: jest.fn(),
        load: jest.fn()
      };
      
      agent.setStorage(mockStorage);
      await agent.startResearch('Test query');
      
      await agent.persistState();
      
      expect(mockStorage.save).toHaveBeenCalledWith(
        'test-session-001',
        expect.objectContaining({
          state: AgentState.ANALYZING,
          context: expect.any(Object),
          messages: expect.any(Array)
        })
      );
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple tool calls correctly', async () => {
      mockLLM.setNextResponse({
        content: 'I need to search multiple topics.',
        toolCalls: [
          { name: 'tavily_search', args: { query: 'AI developments' } },
          { name: 'tavily_search', args: { query: 'ML algorithms' } },
          { name: 'pinecone_query', args: { query: 'neural networks' } }
        ]
      });

      await agent.startResearch('Comprehensive AI research');
      
      expect(mockSearch.search).toHaveBeenCalledTimes(2);
      expect(mockVector.query).toHaveBeenCalledTimes(1);
      expect(agent.getActiveTools()).toHaveLength(3);
    });

    it('should handle partial tool failures', async () => {
      mockLLM.setNextResponse({
        toolCalls: [
          { name: 'tavily_search', args: { query: 'success query' } },
          { name: 'tavily_search', args: { query: 'fail query' } }
        ]
      });

      // Mock one search to fail
      mockSearch.setConditionalError('fail query', new Error('Search failed'));

      await agent.startResearch('Test query');
      
      expect(agent.getState()).toBe(AgentState.SEARCHING);
      expect(agent.getContext().sources).toHaveLength(1); // Only successful search
    });
  });

  describe('Performance Metrics', () => {
    it('should track operation timings', async () => {
      const performanceSpy = jest.fn();
      agent.on('performanceMetric', performanceSpy);
      
      await agent.startResearch('Performance test');
      
      expect(performanceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'stateTransition',
          from: AgentState.IDLE,
          to: AgentState.ANALYZING,
          duration: expect.any(Number)
        })
      );
    });

    it('should measure tool execution times', async () => {
      const toolMetricSpy = jest.fn();
      agent.on('toolMetric', toolMetricSpy);
      
      mockLLM.setNextResponse({
        toolCalls: [{ name: 'tavily_search', args: { query: 'test' } }]
      });

      await agent.startResearch('Tool timing test');
      
      expect(toolMetricSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'tavily_search',
          duration: expect.any(Number),
          success: true
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty LLM responses', async () => {
      mockLLM.setNextResponse({ content: '', toolCalls: [] });
      
      await agent.startResearch('Empty response test');
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('Empty response');
    });

    it('should handle malformed tool calls', async () => {
      mockLLM.setNextResponse({
        content: 'Testing malformed tools',
        toolCalls: [
          { name: 'invalid_tool', args: { query: 'test' } },
          { name: 'tavily_search', args: { invalidParam: 'test' } }
        ]
      });

      await agent.startResearch('Malformed tool test');
      
      expect(agent.getState()).toBe(AgentState.ERROR);
      expect(agent.getContext().error).toContain('Invalid tool');
    });

    it('should handle extremely long content', async () => {
      const longContent = 'A'.repeat(100000); // 100k characters
      
      mockSearch.setSearchResults([{
        title: 'Long Content',
        content: longContent,
        url: 'https://example.com/long',
        score: 0.9
      }]);

      mockLLM.setNextResponse({
        toolCalls: [{ name: 'tavily_search', args: { query: 'test' } }]
      });

      await agent.startResearch('Long content test');
      
      // Should truncate content appropriately
      const sources = agent.getContext().sources;
      expect(sources[0].content.length).toBeLessThan(50000);
    });
  });
});

describe('ResearchAgent Integration Points', () => {
  let agent: ResearchAgent;

  beforeEach(() => {
    agent = new ResearchAgent({
      sessionId: 'integration-test',
      llmProvider: new MockLLMProvider(),
      searchProvider: new MockSearchProvider(),
      vectorStore: new MockVectorStore()
    });
  });

  it('should integrate with observability system', async () => {
    const metricsCollector = {
      startResearchQuery: jest.fn(),
      completeResearchQuery: jest.fn(),
      recordToolUsage: jest.fn()
    };

    agent.setMetricsCollector(metricsCollector);
    
    await agent.startResearch('Observability test');
    
    expect(metricsCollector.startResearchQuery).toHaveBeenCalledWith(
      'integration-test',
      expect.any(Object)
    );
  });

  it('should integrate with error tracking', async () => {
    const errorTracker = {
      trackError: jest.fn(),
      trackPerformance: jest.fn()
    };

    agent.setErrorTracker(errorTracker);
    
    // Force an error
    agent.getMockLLM().setError(new Error('Integration test error'));
    
    await agent.startResearch('Error tracking test');
    
    expect(errorTracker.trackError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        sessionId: 'integration-test',
        state: expect.any(String)
      })
    );
  });

  it('should integrate with cost optimizer', async () => {
    const costOptimizer = {
      optimizeOpenAICall: jest.fn().mockResolvedValue({
        response: 'Optimized response',
        cost: 0.05
      }),
      trackUsage: jest.fn()
    };

    agent.setCostOptimizer(costOptimizer);
    
    await agent.startResearch('Cost optimization test');
    
    expect(costOptimizer.optimizeOpenAICall).toHaveBeenCalled();
  });
});