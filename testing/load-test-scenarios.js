/**
 * Comprehensive Load Testing Scenarios for AI Research Agent
 * 
 * This file contains various load testing scenarios to evaluate system performance
 * under different conditions and identify optimization opportunities.
 */

import { performance } from 'perf_hooks';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class LoadTestRunner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
      wsUrl: process.env.WS_URL || 'ws://localhost:3001',
      apiKey: process.env.API_KEY || 'test-key',
      timeout: 60000,
      retryAttempts: 3,
      ...config
    };
    
    this.results = {
      scenarios: {},
      summary: {},
      recommendations: []
    };
    
    this.activeConnections = new Map();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      responseTimes: [],
      errors: [],
      throughput: 0
    };
  }

  // Scenario 1: 100 Concurrent Research Sessions
  async scenario1_ConcurrentSessions() {
    console.log('🚀 Starting Scenario 1: 100 Concurrent Research Sessions');
    const startTime = performance.now();
    const concurrency = 100;
    const queries = this.generateTestQueries(concurrency);
    
    const results = {
      name: 'Concurrent Research Sessions',
      concurrency,
      duration: 0,
      successRate: 0,
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      throughput: 0,
      errors: [],
      resourceUsage: {}
    };

    try {
      // Start resource monitoring
      const resourceMonitor = this.startResourceMonitoring();
      
      // Execute concurrent requests
      const promises = queries.map((query, index) => 
        this.executeResearchQuery(query, `session_${index}`)
      );
      
      const responses = await Promise.allSettled(promises);
      const endTime = performance.now();
      
      // Stop resource monitoring
      const resourceUsage = await this.stopResourceMonitoring(resourceMonitor);
      
      // Calculate results
      results.duration = endTime - startTime;
      results.successRate = (responses.filter(r => r.status === 'fulfilled').length / concurrency) * 100;
      results.avgResponseTime = this.calculateAverageResponseTime(responses);
      results.p95ResponseTime = this.calculatePercentile(responses, 95);
      results.p99ResponseTime = this.calculatePercentile(responses, 99);
      results.throughput = concurrency / (results.duration / 1000);
      results.errors = responses.filter(r => r.status === 'rejected').map(r => r.reason);
      results.resourceUsage = resourceUsage;
      
      this.results.scenarios.scenario1 = results;
      this.emit('scenarioComplete', 'scenario1', results);
      
      console.log(`✅ Scenario 1 Complete: ${results.successRate}% success rate, ${results.avgResponseTime}ms avg response time`);
      
    } catch (error) {
      results.errors.push(error.message);
      console.error('❌ Scenario 1 Failed:', error.message);
    }
    
    return results;
  }

  // Scenario 2: 1000 SSE Connections
  async scenario2_SSEConnections() {
    console.log('🚀 Starting Scenario 2: 1000 SSE Connections');
    const startTime = performance.now();
    const connectionCount = 1000;
    
    const results = {
      name: 'SSE Connections',
      connectionCount,
      duration: 0,
      establishedConnections: 0,
      failedConnections: 0,
      avgConnectionTime: 0,
      messageLatency: 0,
      memoryUsage: 0,
      errors: []
    };

    try {
      // Start memory monitoring
      const initialMemory = process.memoryUsage();
      
      // Establish connections in batches to avoid overwhelming the server
      const batchSize = 50;
      const batches = Math.ceil(connectionCount / batchSize);
      
      for (let batch = 0; batch < batches; batch++) {
        const batchPromises = [];
        const batchStart = batch * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, connectionCount);
        
        for (let i = batchStart; i < batchEnd; i++) {
          batchPromises.push(this.establishSSEConnection(`sse_${i}`));
        }
        
        await Promise.allSettled(batchPromises);
        
        // Small delay between batches
        await this.sleep(100);
      }
      
      // Keep connections open for test duration
      await this.sleep(30000); // 30 seconds
      
      // Send test messages through all connections
      const messageStartTime = performance.now();
      await this.broadcastTestMessage();
      const messageEndTime = performance.now();
      
      const endTime = performance.now();
      const finalMemory = process.memoryUsage();
      
      // Calculate results
      results.duration = endTime - startTime;
      results.establishedConnections = this.activeConnections.size;
      results.failedConnections = connectionCount - results.establishedConnections;
      results.avgConnectionTime = results.duration / connectionCount;
      results.messageLatency = messageEndTime - messageStartTime;
      results.memoryUsage = finalMemory.heapUsed - initialMemory.heapUsed;
      
      // Clean up connections
      await this.closeAllConnections();
      
      this.results.scenarios.scenario2 = results;
      this.emit('scenarioComplete', 'scenario2', results);
      
      console.log(`✅ Scenario 2 Complete: ${results.establishedConnections}/${connectionCount} connections established`);
      
    } catch (error) {
      results.errors.push(error.message);
      console.error('❌ Scenario 2 Failed:', error.message);
    }
    
    return results;
  }

  // Scenario 3: 10,000 Pinecone Queries per Minute
  async scenario3_PineconeQueries() {
    console.log('🚀 Starting Scenario 3: 10,000 Pinecone Queries per Minute');
    const startTime = performance.now();
    const targetQPM = 10000; // Queries per minute
    const testDuration = 60000; // 1 minute in milliseconds
    const queryInterval = testDuration / targetQPM; // ms between queries
    
    const results = {
      name: 'Pinecone Query Load',
      targetQPM,
      actualQPM: 0,
      duration: testDuration,
      successfulQueries: 0,
      failedQueries: 0,
      avgQueryTime: 0,
      p95QueryTime: 0,
      vectorCacheHitRate: 0,
      errors: []
    };

    try {
      const queryPromises = [];
      const queryTimes = [];
      let queryCount = 0;
      
      // Generate test vectors
      const testVectors = this.generateTestVectors(targetQPM);
      
      const queryTimer = setInterval(() => {
        if (queryCount >= targetQPM) {
          clearInterval(queryTimer);
          return;
        }
        
        const vector = testVectors[queryCount % testVectors.length];
        const queryPromise = this.executePineconeQuery(vector, `query_${queryCount}`)
          .then(result => {
            queryTimes.push(result.responseTime);
            return result;
          });
        
        queryPromises.push(queryPromise);
        queryCount++;
      }, queryInterval);
      
      // Wait for test duration
      await this.sleep(testDuration);
      clearInterval(queryTimer);
      
      // Wait for all queries to complete
      const queryResults = await Promise.allSettled(queryPromises);
      const endTime = performance.now();
      
      // Calculate results
      results.actualQPM = (queryResults.length / testDuration) * 60000;
      results.successfulQueries = queryResults.filter(r => r.status === 'fulfilled').length;
      results.failedQueries = queryResults.filter(r => r.status === 'rejected').length;
      results.avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      results.p95QueryTime = this.calculatePercentileFromArray(queryTimes, 95);
      results.vectorCacheHitRate = this.calculateCacheHitRate();
      results.errors = queryResults.filter(r => r.status === 'rejected').map(r => r.reason);
      
      this.results.scenarios.scenario3 = results;
      this.emit('scenarioComplete', 'scenario3', results);
      
      console.log(`✅ Scenario 3 Complete: ${results.actualQPM} QPM achieved, ${results.avgQueryTime}ms avg query time`);
      
    } catch (error) {
      results.errors.push(error.message);
      console.error('❌ Scenario 3 Failed:', error.message);
    }
    
    return results;
  }

  // Scenario 4: Mixed Workload (Short + Long Research)
  async scenario4_MixedWorkload() {
    console.log('🚀 Starting Scenario 4: Mixed Workload (Short + Long Research)');
    const startTime = performance.now();
    
    const results = {
      name: 'Mixed Workload',
      shortQueries: 0,
      longQueries: 0,
      concurrentUsers: 50,
      duration: 0,
      shortQueryAvgTime: 0,
      longQueryAvgTime: 0,
      overallSuccessRate: 0,
      resourceUtilization: {},
      errors: []
    };

    try {
      const concurrentUsers = 50;
      const testDuration = 300000; // 5 minutes
      const shortQueries = this.generateShortQueries(100);
      const longQueries = this.generateLongQueries(25);
      
      // Start resource monitoring
      const resourceMonitor = this.startResourceMonitoring();
      
      // Create mixed workload promises
      const workloadPromises = [];
      
      // Short queries (70% of workload)
      for (let i = 0; i < concurrentUsers * 0.7; i++) {
        workloadPromises.push(
          this.executeContinuousQueries(shortQueries, `short_user_${i}`, testDuration)
        );
      }
      
      // Long queries (30% of workload)
      for (let i = 0; i < concurrentUsers * 0.3; i++) {
        workloadPromises.push(
          this.executeContinuousQueries(longQueries, `long_user_${i}`, testDuration)
        );
      }
      
      // Execute mixed workload
      const workloadResults = await Promise.allSettled(workloadPromises);
      const endTime = performance.now();
      
      // Stop resource monitoring
      const resourceUtilization = await this.stopResourceMonitoring(resourceMonitor);
      
      // Calculate results
      const allResults = workloadResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
        .flat();
      
      const shortResults = allResults.filter(r => r.queryType === 'short');
      const longResults = allResults.filter(r => r.queryType === 'long');
      
      results.duration = endTime - startTime;
      results.shortQueries = shortResults.length;
      results.longQueries = longResults.length;
      results.shortQueryAvgTime = this.calculateAverageFromResults(shortResults);
      results.longQueryAvgTime = this.calculateAverageFromResults(longResults);
      results.overallSuccessRate = (allResults.filter(r => r.success).length / allResults.length) * 100;
      results.resourceUtilization = resourceUtilization;
      results.errors = workloadResults.filter(r => r.status === 'rejected').map(r => r.reason);
      
      this.results.scenarios.scenario4 = results;
      this.emit('scenarioComplete', 'scenario4', results);
      
      console.log(`✅ Scenario 4 Complete: ${results.overallSuccessRate}% success rate across mixed workload`);
      
    } catch (error) {
      results.errors.push(error.message);
      console.error('❌ Scenario 4 Failed:', error.message);
    }
    
    return results;
  }

  // Scenario 5: Sustained Load for 24 Hours
  async scenario5_SustainedLoad() {
    console.log('🚀 Starting Scenario 5: Sustained Load for 24 Hours');
    const startTime = performance.now();
    const testDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    
    const results = {
      name: 'Sustained Load',
      duration: testDuration,
      targetRPS: 10, // Sustainable 10 requests per second
      actualRPS: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      memoryLeaks: false,
      performanceDegradation: false,
      errors: [],
      hourlyMetrics: []
    };

    try {
      const targetRPS = 10;
      const requestInterval = 1000 / targetRPS; // ms between requests
      let requestCount = 0;
      const startTimestamp = Date.now();
      
      // Arrays to track performance over time
      const hourlyMetrics = [];
      const responseTimes = [];
      const memoryUsages = [];
      
      console.log(`📊 Sustained load test will run for 24 hours at ${targetRPS} RPS`);
      console.log('💡 This is a long-running test. Consider running with --sustained-load-preview for shorter duration testing.');
      
      // Check if this is a preview run
      const isPreview = process.env.LOAD_TEST_PREVIEW === 'true';
      const actualDuration = isPreview ? 300000 : testDuration; // 5 minutes for preview
      
      if (isPreview) {
        console.log('🔍 Running in preview mode (5 minutes instead of 24 hours)');
      }
      
      // Execute sustained load
      const endTime = startTimestamp + actualDuration;
      
      while (Date.now() < endTime) {
        const requestStartTime = performance.now();
        
        try {
          const query = this.generateRandomQuery();
          const result = await this.executeResearchQuery(query, `sustained_${requestCount}`);
          
          responseTimes.push(performance.now() - requestStartTime);
          requestCount++;
          
          // Collect hourly metrics
          if (requestCount % (3600 * targetRPS) === 0 || isPreview && requestCount % (60 * targetRPS) === 0) {
            const currentHour = Math.floor((Date.now() - startTimestamp) / (isPreview ? 60000 : 3600000));
            const memoryUsage = process.memoryUsage();
            
            hourlyMetrics.push({
              hour: currentHour,
              requests: requestCount,
              avgResponseTime: responseTimes.slice(-3600 * targetRPS).reduce((a, b) => a + b, 0) / (3600 * targetRPS),
              memoryUsage: memoryUsage.heapUsed,
              timestamp: Date.now()
            });
            
            memoryUsages.push(memoryUsage.heapUsed);
            
            console.log(`📈 ${isPreview ? 'Minute' : 'Hour'} ${currentHour + 1}: ${requestCount} requests, ${Math.round(responseTimes[responseTimes.length - 1])}ms last response`);
          }
          
        } catch (error) {
          results.errors.push({
            timestamp: Date.now(),
            error: error.message,
            requestNumber: requestCount
          });
        }
        
        // Wait for next request interval
        await this.sleep(requestInterval);
      }
      
      // Calculate final results
      const actualTestDuration = Date.now() - startTimestamp;
      results.actualRPS = (requestCount / actualTestDuration) * 1000;
      results.totalRequests = requestCount;
      results.successfulRequests = requestCount - results.errors.length;
      results.failedRequests = results.errors.length;
      results.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      results.hourlyMetrics = hourlyMetrics;
      
      // Detect memory leaks
      if (memoryUsages.length > 2) {
        const initialMemory = memoryUsages[0];
        const finalMemory = memoryUsages[memoryUsages.length - 1];
        const memoryIncrease = (finalMemory - initialMemory) / initialMemory;
        results.memoryLeaks = memoryIncrease > 0.5; // 50% increase indicates potential leak
      }
      
      // Detect performance degradation
      if (responseTimes.length > 1000) {
        const initialAvg = responseTimes.slice(0, 100).reduce((a, b) => a + b, 0) / 100;
        const finalAvg = responseTimes.slice(-100).reduce((a, b) => a + b, 0) / 100;
        results.performanceDegradation = (finalAvg - initialAvg) / initialAvg > 0.3; // 30% degradation
      }
      
      this.results.scenarios.scenario5 = results;
      this.emit('scenarioComplete', 'scenario5', results);
      
      console.log(`✅ Scenario 5 Complete: ${results.actualRPS} RPS sustained, ${results.avgResponseTime}ms avg response time`);
      
    } catch (error) {
      results.errors.push(error.message);
      console.error('❌ Scenario 5 Failed:', error.message);
    }
    
    return results;
  }

  // Execute all scenarios
  async runAllScenarios(options = {}) {
    console.log('🚀 Starting Comprehensive Load Testing Suite');
    
    const scenarios = [
      this.scenario1_ConcurrentSessions,
      this.scenario2_SSEConnections,
      this.scenario3_PineconeQueries,
      this.scenario4_MixedWorkload
    ];
    
    // Add sustained load if requested
    if (options.includeSustainedLoad) {
      scenarios.push(this.scenario5_SustainedLoad);
    }
    
    const startTime = performance.now();
    
    for (const scenario of scenarios) {
      try {
        await scenario.call(this);
        
        // Cool-down period between scenarios
        console.log('⏳ Cool-down period...');
        await this.sleep(30000); // 30 seconds
        
      } catch (error) {
        console.error(`❌ Scenario failed: ${error.message}`);
      }
    }
    
    const endTime = performance.now();
    
    // Generate comprehensive analysis
    this.generateAnalysisReport();
    this.generateOptimizationRecommendations();
    
    console.log(`🎉 Load testing complete! Duration: ${Math.round((endTime - startTime) / 1000)}s`);
    
    return this.results;
  }

  // Helper Methods
  
  async executeResearchQuery(query, sessionId) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(`${this.config.baseUrl}/api/research`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          query,
          sessionId,
          stream: false
        }),
        timeout: this.config.timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const responseTime = performance.now() - startTime;
      
      return {
        success: true,
        responseTime,
        sessionId,
        result
      };
      
    } catch (error) {
      const responseTime = performance.now() - startTime;
      return {
        success: false,
        responseTime,
        sessionId,
        error: error.message
      };
    }
  }

  async establishSSEConnection(connectionId) {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(`${this.config.wsUrl}/api/research/stream`);
        
        ws.on('open', () => {
          this.activeConnections.set(connectionId, ws);
          resolve({ connectionId, connected: true });
        });
        
        ws.on('error', (error) => {
          reject(new Error(`Connection ${connectionId} failed: ${error.message}`));
        });
        
        ws.on('close', () => {
          this.activeConnections.delete(connectionId);
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  async executePineconeQuery(vector, queryId) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(`${this.config.baseUrl}/api/vector/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          vector,
          topK: 10,
          queryId
        }),
        timeout: 5000 // Shorter timeout for vector queries
      });
      
      if (!response.ok) {
        throw new Error(`Vector query failed: ${response.statusText}`);
      }
      
      const result = await response.json();
      const responseTime = performance.now() - startTime;
      
      return {
        success: true,
        responseTime,
        queryId,
        results: result.matches?.length || 0
      };
      
    } catch (error) {
      const responseTime = performance.now() - startTime;
      throw new Error(`Query ${queryId} failed: ${error.message}`);
    }
  }

  generateTestQueries(count) {
    const templates = [
      "What are the latest developments in artificial intelligence?",
      "How does climate change affect global economics?",
      "What are the best practices for software architecture?",
      "Explain the current state of renewable energy technology",
      "What are the implications of quantum computing?",
      "How do machine learning algorithms work?",
      "What are the trends in cybersecurity?",
      "Analyze the impact of remote work on productivity",
      "What are the latest medical breakthroughs?",
      "How is blockchain technology being adopted?"
    ];
    
    return Array.from({ length: count }, (_, i) => 
      templates[i % templates.length] + ` (Test ${i + 1})`
    );
  }

  generateShortQueries(count) {
    const short = [
      "Define AI",
      "What is React?",
      "Explain REST API",
      "Docker benefits",
      "Git vs SVN"
    ];
    
    return Array.from({ length: count }, (_, i) => ({
      query: short[i % short.length],
      type: 'short',
      expectedDuration: 5000 // 5 seconds
    }));
  }

  generateLongQueries(count) {
    const long = [
      "Provide a comprehensive analysis of distributed systems architecture patterns and their trade-offs",
      "Explain the complete software development lifecycle including modern methodologies and best practices",
      "Analyze the current state and future prospects of artificial intelligence across different industries"
    ];
    
    return Array.from({ length: count }, (_, i) => ({
      query: long[i % long.length],
      type: 'long',
      expectedDuration: 30000 // 30 seconds
    }));
  }

  generateTestVectors(count) {
    return Array.from({ length: count }, () => 
      Array.from({ length: 1536 }, () => Math.random() * 2 - 1)
    );
  }

  generateRandomQuery() {
    const queries = this.generateTestQueries(10);
    return queries[Math.floor(Math.random() * queries.length)];
  }

  startResourceMonitoring() {
    const monitor = {
      interval: setInterval(() => {
        monitor.readings.push({
          timestamp: Date.now(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage()
        });
      }, 1000),
      readings: []
    };
    
    return monitor;
  }

  async stopResourceMonitoring(monitor) {
    clearInterval(monitor.interval);
    
    return {
      totalReadings: monitor.readings.length,
      avgMemoryUsage: monitor.readings.reduce((sum, r) => sum + r.memory.heapUsed, 0) / monitor.readings.length,
      peakMemoryUsage: Math.max(...monitor.readings.map(r => r.memory.heapUsed)),
      avgCpuUsage: monitor.readings.reduce((sum, r) => sum + r.cpu.user, 0) / monitor.readings.length
    };
  }

  generateAnalysisReport() {
    const scenarios = this.results.scenarios;
    
    this.results.summary = {
      totalScenarios: Object.keys(scenarios).length,
      overallSuccessRate: this.calculateOverallSuccessRate(scenarios),
      performanceBaseline: this.establishPerformanceBaseline(scenarios),
      bottlenecks: this.identifyBottlenecks(scenarios),
      scalabilityLimits: this.assessScalabilityLimits(scenarios)
    };
  }

  generateOptimizationRecommendations() {
    const recommendations = [];
    const scenarios = this.results.scenarios;
    
    // Analyze each scenario for recommendations
    if (scenarios.scenario1?.avgResponseTime > 10000) {
      recommendations.push({
        priority: 'high',
        category: 'performance',
        issue: 'High response times under concurrent load',
        recommendation: 'Implement request queuing and connection pooling',
        expectedImprovement: '40-60% response time reduction'
      });
    }
    
    if (scenarios.scenario2?.failedConnections > scenarios.scenario2?.connectionCount * 0.1) {
      recommendations.push({
        priority: 'high',
        category: 'scalability',
        issue: 'SSE connection failures under load',
        recommendation: 'Implement connection throttling and load balancing',
        expectedImprovement: '90%+ connection success rate'
      });
    }
    
    if (scenarios.scenario3?.actualQPM < scenarios.scenario3?.targetQPM * 0.8) {
      recommendations.push({
        priority: 'medium',
        category: 'database',
        issue: 'Pinecone query throughput below target',
        recommendation: 'Implement vector caching and query optimization',
        expectedImprovement: '2-3x query throughput increase'
      });
    }
    
    this.results.recommendations = recommendations;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  calculateAverageResponseTime(responses) {
    const times = responses
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.responseTime);
    return times.reduce((a, b) => a + b, 0) / times.length;
  }

  calculatePercentile(responses, percentile) {
    const times = responses
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.responseTime)
      .sort((a, b) => a - b);
    
    const index = Math.ceil((percentile / 100) * times.length) - 1;
    return times[index] || 0;
  }

  calculatePercentileFromArray(array, percentile) {
    const sorted = array.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
  }
}

// Export for use in testing
export default LoadTestRunner;