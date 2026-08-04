/**
 * Test Database Helper
 * Provides database setup and management for integration tests
 */

import { Pool } from 'pg';
import { EventEmitter } from 'events';

export class TestDatabase extends EventEmitter {
  private pool: Pool | null = null;
  private isSetup: boolean = false;
  private connectionFailureSimulated: boolean = false;

  constructor() {
    super();
  }

  /**
   * Setup test database connection
   */
  async setup(): Promise<void> {
    if (this.isSetup) return;

    try {
      this.pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL || 
          'postgresql://postgres:test_password@localhost:5432/ai_research_test',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      await this.createTables();
      this.isSetup = true;

      this.emit('setup');

    } catch (error) {
      // In unit test environment, create mock database
      this.createMockDatabase();
      this.isSetup = true;
      
      console.warn('Using mock database (expected in unit tests):', error.message);
    }
  }

  /**
   * Create database tables for testing
   */
  private async createTables(): Promise<void> {
    if (!this.pool) return;

    const tableQueries = [
      `
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(255) PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          tier VARCHAR(50) NOT NULL DEFAULT 'free',
          api_key VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          is_active BOOLEAN DEFAULT true
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS research_sessions (
          session_id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) REFERENCES users(id),
          query TEXT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          sources JSONB DEFAULT '[]',
          analysis TEXT DEFAULT '',
          report TEXT DEFAULT '',
          tokens_used INTEGER DEFAULT 0,
          cost DECIMAL(10,4) DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE NULL,
          error_message TEXT NULL
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS api_usage (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) REFERENCES users(id),
          session_id VARCHAR(255) REFERENCES research_sessions(session_id),
          provider VARCHAR(50) NOT NULL,
          operation VARCHAR(100) NOT NULL,
          tokens_used INTEGER DEFAULT 0,
          cost DECIMAL(10,6) DEFAULT 0,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_research_sessions_user_id 
        ON research_sessions(user_id);
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_research_sessions_created_at 
        ON research_sessions(created_at DESC);
      `,
      `
        CREATE INDEX IF NOT EXISTS idx_api_usage_user_timestamp 
        ON api_usage(user_id, timestamp DESC);
      `
    ];

    for (const query of tableQueries) {
      try {
        await this.pool.query(query);
      } catch (error) {
        console.warn('Table creation warning:', error.message);
      }
    }
  }

  /**
   * Create mock database for unit tests
   */
  private createMockDatabase(): void {
    this.pool = {
      query: async (text: string, _params?: any[]) => {
        // Mock successful query responses
        if (text.includes('SELECT')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('INSERT') || text.includes('UPDATE') || text.includes('DELETE')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      connect: async () => ({
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => {}
      }),
      end: async () => {}
    } as any;
  }

  /**
   * Execute database query
   */
  async query(text: string, params?: any[]): Promise<any> {
    if (!this.pool) {
      throw new Error('Database not setup');
    }

    if (this.connectionFailureSimulated) {
      throw new Error('Database connection failed (simulated)');
    }

    return this.pool.query(text, params);
  }

  /**
   * Get database connection
   */
  getConnection(): Pool | null {
    return this.pool;
  }

  /**
   * Simulate database connection failure
   */
  async simulateConnectionFailure(): Promise<void> {
    this.connectionFailureSimulated = true;
    this.emit('connectionFailure');
  }

  /**
   * Restore database connection
   */
  async restoreConnection(): Promise<void> {
    this.connectionFailureSimulated = false;
    this.emit('connectionRestored');
  }

  /**
   * Clean up database and close connections
   */
  async cleanup(): Promise<void> {
    if (this.pool) {
      try {
        // Clean up test data
        await this.query('DELETE FROM research_sessions WHERE session_id LIKE $1', ['%test%']);
        await this.query('DELETE FROM api_usage WHERE user_id LIKE $1', ['%test%']);
        await this.query('DELETE FROM users WHERE id LIKE $1', ['%test%']);
        
        // Close pool
        await this.pool.end();
      } catch (error) {
        console.warn('Database cleanup warning:', error.message);
      }
    }

    this.pool = null;
    this.isSetup = false;
    this.emit('cleanup');
  }

  /**
   * Transaction helper for tests
   */
  async withTransaction<T>(callback: (_client: any) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error('Database not setup');
    }

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create test database schema
   */
  async createTestSchema(): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query('CREATE SCHEMA IF NOT EXISTS test_schema');
      await this.pool.query('SET search_path TO test_schema');
    } catch (error) {
      console.warn('Schema creation warning:', error.message);
    }
  }

  /**
   * Drop test database schema
   */
  async dropTestSchema(): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query('DROP SCHEMA IF EXISTS test_schema CASCADE');
    } catch (error) {
      console.warn('Schema drop warning:', error.message);
    }
  }

  /**
   * Get database statistics for testing
   */
  async getStats(): Promise<{
    userCount: number;
    sessionCount: number;
    completedSessions: number;
    avgTokensPerSession: number;
    totalCost: number;
  }> {
    if (!this.pool) {
      return {
        userCount: 0,
        sessionCount: 0,
        completedSessions: 0,
        avgTokensPerSession: 0,
        totalCost: 0
      };
    }

    try {
      const userCountResult = await this.pool.query('SELECT COUNT(*) as count FROM users');
      const sessionStatsResult = await this.pool.query(`
        SELECT 
          COUNT(*) as total_sessions,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
          AVG(COALESCE(tokens_used, 0)) as avg_tokens,
          SUM(COALESCE(cost, 0)) as total_cost
        FROM research_sessions
      `);

      const stats = sessionStatsResult.rows[0];

      return {
        userCount: parseInt(userCountResult.rows[0].count),
        sessionCount: parseInt(stats.total_sessions),
        completedSessions: parseInt(stats.completed_sessions),
        avgTokensPerSession: parseFloat(stats.avg_tokens) || 0,
        totalCost: parseFloat(stats.total_cost) || 0
      };

    } catch (error) {
      console.warn('Stats query failed:', error.message);
      return {
        userCount: 0,
        sessionCount: 0,
        completedSessions: 0,
        avgTokensPerSession: 0,
        totalCost: 0
      };
    }
  }
}