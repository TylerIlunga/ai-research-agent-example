/**
 * Test Data Seeder for Consistent Testing
 * Provides seed data for unit and integration tests
 */

import { randomBytes } from 'crypto';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  tier: 'free' | 'premium' | 'enterprise';
  apiKey: string;
  createdAt: Date;
  isActive: boolean;
}

export interface TestSession {
  id: string;
  userId: string;
  query: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  sources: any[];
  analysis: string;
  tokensUsed: number;
  cost: number;
  createdAt: Date;
  completedAt?: Date;
}

export interface TestVector {
  id: string;
  namespace: string;
  values: number[];
  metadata: Record<string, any>;
}

export class TestDataSeeder {
  private database: any;
  private seededData: {
    users: TestUser[];
    sessions: TestSession[];
    vectors: TestVector[];
  } = {
    users: [],
    sessions: [],
    vectors: []
  };

  constructor(database: any) {
    this.database = database;
  }

  /**
   * Seed all test data
   */
  async seedAll(): Promise<void> {
    await this.seedUsers();
    await this.seedSessions();
    await this.seedVectors();
  }

  /**
   * Seed test users with different tiers
   */
  async seedUsers(): Promise<TestUser[]> {
    const users: TestUser[] = [
      {
        id: 'user-free-001',
        email: 'free.user@example.com',
        name: 'Free User',
        tier: 'free',
        apiKey: this.generateApiKey(),
        createdAt: new Date('2024-01-01'),
        isActive: true
      },
      {
        id: 'user-premium-001',
        email: 'premium.user@example.com',
        name: 'Premium User',
        tier: 'premium',
        apiKey: this.generateApiKey(),
        createdAt: new Date('2024-01-15'),
        isActive: true
      },
      {
        id: 'user-enterprise-001',
        email: 'enterprise.user@example.com',
        name: 'Enterprise User',
        tier: 'enterprise',
        apiKey: this.generateApiKey(),
        createdAt: new Date('2024-02-01'),
        isActive: true
      },
      {
        id: 'user-inactive-001',
        email: 'inactive.user@example.com',
        name: 'Inactive User',
        tier: 'free',
        apiKey: this.generateApiKey(),
        createdAt: new Date('2023-12-01'),
        isActive: false
      }
    ];

    // Insert users into database if available
    if (this.database && this.database.query) {
      for (const user of users) {
        try {
          await this.database.query(`
            INSERT INTO users (id, email, name, tier, api_key, created_at, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
              email = EXCLUDED.email,
              name = EXCLUDED.name,
              tier = EXCLUDED.tier,
              api_key = EXCLUDED.api_key,
              is_active = EXCLUDED.is_active
          `, [user.id, user.email, user.name, user.tier, user.apiKey, user.createdAt, user.isActive]);
        } catch (error) {
          // Ignore database errors in test environment
          console.warn('Database seeding failed (expected in unit tests):', error.message);
        }
      }
    }

    this.seededData.users = users;
    return users;
  }

  /**
   * Seed test research sessions
   */
  async seedSessions(): Promise<TestSession[]> {
    const sessions: TestSession[] = [
      {
        id: 'session-001',
        userId: 'user-free-001',
        query: 'What are the latest developments in artificial intelligence?',
        status: 'completed',
        sources: this.generateMockSources(3),
        analysis: 'AI has seen significant developments in 2024...',
        tokensUsed: 2500,
        cost: 0.125,
        createdAt: new Date('2024-01-10T10:00:00Z'),
        completedAt: new Date('2024-01-10T10:02:30Z')
      },
      {
        id: 'session-002',
        userId: 'user-premium-001',
        query: 'How does quantum computing impact cybersecurity?',
        status: 'completed',
        sources: this.generateMockSources(5),
        analysis: 'Quantum computing presents both opportunities and challenges for cybersecurity...',
        tokensUsed: 4200,
        cost: 0.21,
        createdAt: new Date('2024-01-12T14:30:00Z'),
        completedAt: new Date('2024-01-12T14:33:45Z')
      },
      {
        id: 'session-003',
        userId: 'user-enterprise-001',
        query: 'Analyze the current state of renewable energy adoption globally',
        status: 'completed',
        sources: this.generateMockSources(8),
        analysis: 'Global renewable energy adoption has accelerated significantly...',
        tokensUsed: 6800,
        cost: 0.34,
        createdAt: new Date('2024-01-15T09:15:00Z'),
        completedAt: new Date('2024-01-15T09:21:20Z')
      },
      {
        id: 'session-004',
        userId: 'user-free-001',
        query: 'Processing query about machine learning',
        status: 'processing',
        sources: [],
        analysis: '',
        tokensUsed: 0,
        cost: 0,
        createdAt: new Date('2024-01-20T16:45:00Z')
      },
      {
        id: 'session-005',
        userId: 'user-premium-001',
        query: 'Failed query example',
        status: 'error',
        sources: [],
        analysis: '',
        tokensUsed: 500,
        cost: 0.025,
        createdAt: new Date('2024-01-18T11:20:00Z')
      }
    ];

    // Insert sessions into database if available
    if (this.database && this.database.query) {
      for (const session of sessions) {
        try {
          await this.database.query(`
            INSERT INTO research_sessions (
              session_id, user_id, query, status, sources, analysis, 
              tokens_used, cost, created_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (session_id) DO UPDATE SET
              status = EXCLUDED.status,
              sources = EXCLUDED.sources,
              analysis = EXCLUDED.analysis,
              tokens_used = EXCLUDED.tokens_used,
              cost = EXCLUDED.cost,
              completed_at = EXCLUDED.completed_at
          `, [
            session.id, session.userId, session.query, session.status,
            JSON.stringify(session.sources), session.analysis,
            session.tokensUsed, session.cost.toString(),
            session.createdAt, session.completedAt
          ]);
        } catch (error) {
          console.warn('Session seeding failed (expected in unit tests):', error.message);
        }
      }
    }

    this.seededData.sessions = sessions;
    return sessions;
  }

  /**
   * Seed test vector embeddings
   */
  async seedVectors(): Promise<TestVector[]> {
    const vectors: TestVector[] = [
      {
        id: 'vec-ai-001',
        namespace: 'research-docs',
        values: this.generateRandomVector(1536),
        metadata: {
          title: 'Artificial Intelligence Overview',
          content: 'Comprehensive overview of AI technologies and applications',
          source: 'ai-research-2024',
          type: 'educational',
          domain: 'artificial-intelligence',
          published_date: '2024-01-01'
        }
      },
      {
        id: 'vec-ml-001',
        namespace: 'research-docs',
        values: this.generateRandomVector(1536),
        metadata: {
          title: 'Machine Learning Fundamentals',
          content: 'Core concepts and algorithms in machine learning',
          source: 'ml-textbook',
          type: 'technical',
          domain: 'machine-learning',
          published_date: '2024-01-05'
        }
      },
      {
        id: 'vec-quantum-001',
        namespace: 'research-docs',
        values: this.generateRandomVector(1536),
        metadata: {
          title: 'Quantum Computing Principles',
          content: 'Introduction to quantum computing and its applications',
          source: 'quantum-research',
          type: 'academic',
          domain: 'quantum-computing',
          published_date: '2024-01-10'
        }
      },
      {
        id: 'vec-energy-001',
        namespace: 'research-docs',
        values: this.generateRandomVector(1536),
        metadata: {
          title: 'Renewable Energy Technologies',
          content: 'Current state and future of renewable energy sources',
          source: 'energy-report-2024',
          type: 'report',
          domain: 'renewable-energy',
          published_date: '2024-01-12'
        }
      }
    ];

    this.seededData.vectors = vectors;
    return vectors;
  }

  /**
   * Seed performance test data (larger dataset)
   */
  async seedPerformanceData(): Promise<{
    users: TestUser[];
    sessions: TestSession[];
    vectors: TestVector[];
  }> {
    const users: TestUser[] = [];
    const sessions: TestSession[] = [];
    const vectors: TestVector[] = [];

    // Generate 100 test users
    for (let i = 1; i <= 100; i++) {
      const tierOptions: ('free' | 'premium' | 'enterprise')[] = ['free', 'premium', 'enterprise'];
      const tier = tierOptions[i % 3];
      
      users.push({
        id: `perf-user-${i.toString().padStart(3, '0')}`,
        email: `perf.user.${i}@example.com`,
        name: `Performance User ${i}`,
        tier,
        apiKey: this.generateApiKey(),
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Last 30 days
        isActive: Math.random() > 0.1 // 90% active
      });
    }

    // Generate 1000 test sessions
    for (let i = 1; i <= 1000; i++) {
      const userId = users[Math.floor(Math.random() * users.length)].id;
      const statuses: ('completed' | 'processing' | 'error')[] = ['completed', 'processing', 'error'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const queries = this.getPerformanceTestQueries();
      
      sessions.push({
        id: `perf-session-${i.toString().padStart(4, '0')}`,
        userId,
        query: queries[Math.floor(Math.random() * queries.length)],
        status,
        sources: status === 'completed' ? this.generateMockSources(Math.floor(Math.random() * 10) + 1) : [],
        analysis: status === 'completed' ? 'Performance test analysis...' : '',
        tokensUsed: Math.floor(Math.random() * 8000) + 500,
        cost: Math.random() * 0.5,
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Last 7 days
        completedAt: status === 'completed' ? new Date(Date.now() - Math.random() * 6 * 24 * 60 * 60 * 1000) : undefined
      });
    }

    // Generate 5000 test vectors
    for (let i = 1; i <= 5000; i++) {
      const domains = ['ai', 'ml', 'quantum', 'energy', 'tech', 'science', 'business'];
      const domain = domains[Math.floor(Math.random() * domains.length)];
      
      vectors.push({
        id: `perf-vec-${i.toString().padStart(5, '0')}`,
        namespace: 'performance-test',
        values: this.generateRandomVector(1536),
        metadata: {
          title: `Performance Test Document ${i}`,
          content: `Performance test content for document ${i}`,
          source: `perf-source-${Math.floor(Math.random() * 100)}`,
          type: 'test',
          domain,
          published_date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
        }
      });
    }

    return { users, sessions, vectors };
  }

  /**
   * Get seeded data for tests
   */
  getSeededData(): {
    users: TestUser[];
    sessions: TestSession[];
    vectors: TestVector[];
  } {
    return this.seededData;
  }

  /**
   * Get specific test user by tier
   */
  getTestUser(tier?: 'free' | 'premium' | 'enterprise'): TestUser {
    if (tier) {
      const user = this.seededData.users.find(u => u.tier === tier && u.isActive);
      if (!user) throw new Error(`No active test user found for tier: ${tier}`);
      return user;
    }
    return this.seededData.users[0];
  }

  /**
   * Get test session by status
   */
  getTestSession(status?: 'pending' | 'processing' | 'completed' | 'error'): TestSession {
    if (status) {
      const session = this.seededData.sessions.find(s => s.status === status);
      if (!session) throw new Error(`No test session found with status: ${status}`);
      return session;
    }
    return this.seededData.sessions[0];
  }

  /**
   * Reset all seeded data
   */
  async reset(): Promise<void> {
    if (this.database && this.database.query) {
      try {
        // Clear test data from database
        await this.database.query('DELETE FROM research_sessions WHERE session_id LIKE $1', ['session-%']);
        await this.database.query('DELETE FROM users WHERE id LIKE $1', ['user-%']);
        await this.database.query('DELETE FROM research_sessions WHERE session_id LIKE $1', ['perf-%']);
        await this.database.query('DELETE FROM users WHERE id LIKE $1', ['perf-%']);
      } catch (error) {
        console.warn('Database reset failed (expected in unit tests):', error.message);
      }
    }

    // Reset in-memory data
    this.seededData = {
      users: [],
      sessions: [],
      vectors: []
    };
  }

  /**
   * Clean up test data
   */
  async cleanup(): Promise<void> {
    await this.reset();
  }

  // Helper methods
  private generateApiKey(): string {
    return 'sk-test-' + randomBytes(24).toString('hex');
  }

  private generateRandomVector(dimensions: number): number[] {
    return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
  }

  private generateMockSources(count: number): any[] {
    const sources = [];
    for (let i = 1; i <= count; i++) {
      sources.push({
        url: `https://example.com/source-${i}`,
        title: `Test Source ${i}`,
        content: `This is test content for source ${i}`,
        score: Math.random() * 0.3 + 0.7, // 0.7-1.0
        type: 'search',
        publishedDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
      });
    }
    return sources;
  }

  private getPerformanceTestQueries(): string[] {
    return [
      'What are the latest developments in artificial intelligence?',
      'How does machine learning impact business operations?',
      'Explain quantum computing principles and applications',
      'What are the benefits of renewable energy adoption?',
      'How does blockchain technology work?',
      'What are the trends in cybersecurity?',
      'Analyze the impact of cloud computing on enterprises',
      'What are the advances in biotechnology?',
      'How is IoT transforming smart cities?',
      'What are the implications of 5G technology?'
    ];
  }

  /**
   * Seed error scenarios for testing
   */
  async seedErrorScenarios(): Promise<void> {
    const errorSessions: TestSession[] = [
      {
        id: 'error-timeout-001',
        userId: 'user-free-001',
        query: 'Query that will timeout',
        status: 'error',
        sources: [],
        analysis: '',
        tokensUsed: 0,
        cost: 0,
        createdAt: new Date(),
      },
      {
        id: 'error-api-001',
        userId: 'user-premium-001',
        query: 'Query that will cause API error',
        status: 'error',
        sources: [],
        analysis: '',
        tokensUsed: 100,
        cost: 0.005,
        createdAt: new Date(),
      },
      {
        id: 'error-invalid-001',
        userId: 'user-enterprise-001',
        query: '',
        status: 'error',
        sources: [],
        analysis: '',
        tokensUsed: 0,
        cost: 0,
        createdAt: new Date(),
      }
    ];

    this.seededData.sessions.push(...errorSessions);
  }

  /**
   * Generate mock analytics data
   */
  generateMockAnalytics(): any {
    return {
      totalUsers: this.seededData.users.length,
      activeUsers: this.seededData.users.filter(u => u.isActive).length,
      totalSessions: this.seededData.sessions.length,
      completedSessions: this.seededData.sessions.filter(s => s.status === 'completed').length,
      totalTokensUsed: this.seededData.sessions.reduce((sum, s) => sum + s.tokensUsed, 0),
      totalCost: this.seededData.sessions.reduce((sum, s) => sum + s.cost, 0),
      avgSessionDuration: 150, // seconds
      successRate: 0.95,
      usersByTier: {
        free: this.seededData.users.filter(u => u.tier === 'free').length,
        premium: this.seededData.users.filter(u => u.tier === 'premium').length,
        enterprise: this.seededData.users.filter(u => u.tier === 'enterprise').length
      }
    };
  }
}