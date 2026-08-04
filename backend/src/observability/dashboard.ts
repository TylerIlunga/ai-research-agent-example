import { EventEmitter } from 'events';
import { metricsCollector, BusinessMetrics } from './metrics';
import { errorTracker } from './errorTracking';
import { globalLangSmithHandler } from './langsmith';

// Dashboard data interfaces
interface DashboardData {
  overview: OverviewMetrics;
  research: ResearchMetrics;
  performance: PerformanceMetrics;
  business: BusinessMetrics;
  users: UserMetrics;
  revenue: RevenueMetrics;
  alerts: AlertMetrics;
  realtime: RealtimeMetrics;
}

interface OverviewMetrics {
  totalQueries: number;
  successRate: number;
  averageResponseTime: number;
  activeUsers: number;
  errorRate: number;
  uptime: number;
  healthScore: number;
}

interface ResearchMetrics {
  completionRate: number;
  averageDuration: number;
  averageTokensPerQuery: number;
  averageSourcesPerQuery: number;
  mostPopularTools: Array<{ name: string; usage: number }>;
  queryComplexityDistribution: Array<{ complexity: string; count: number }>;
  timeToFirstResult: number;
  userSatisfactionScore: number;
}

interface PerformanceMetrics {
  apiLatency: {
    p50: number;
    p95: number;
    p99: number;
  };
  systemResources: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  };
  externalAPIHealth: Array<{
    provider: string;
    status: 'healthy' | 'degraded' | 'down';
    latency: number;
    errorRate: number;
  }>;
  connectionMetrics: {
    active: number;
    peak: number;
    averageDuration: number;
  };
}

interface UserMetrics {
  totalUsers: number;
  activeUsers: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  userGrowth: Array<{ date: string; newUsers: number; churnedUsers: number }>;
  userEngagement: {
    averageSessionDuration: number;
    queriesPerSession: number;
    returnRate: number;
  };
  tierDistribution: Array<{ tier: string; count: number; revenue: number }>;
}

interface RevenueMetrics {
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  revenuePerUser: number;
  costPerQuery: number;
  profitMargin: number;
  revenueGrowth: Array<{ month: string; revenue: number; growth: number }>;
  topCustomers: Array<{ id: string; revenue: number; queries: number }>;
}

interface AlertMetrics {
  activeAlerts: number;
  alertsByPriority: Record<string, number>;
  recentIncidents: Array<{
    id: string;
    type: string;
    severity: string;
    timestamp: number;
    resolved: boolean;
    duration?: number;
  }>;
  mttr: number; // Mean Time To Resolution
  mtbf: number; // Mean Time Between Failures
}

interface RealtimeMetrics {
  currentRPS: number;
  activeConnections: number;
  queueLength: number;
  lastUpdated: number;
  trends: {
    requests: Array<{ timestamp: number; count: number }>;
    errors: Array<{ timestamp: number; count: number }>;
    latency: Array<{ timestamp: number; value: number }>;
  };
}

// Dashboard implementation
export class BusinessDashboard extends EventEmitter {
  private historicalData: Map<string, any[]> = new Map();
  private realtimeBuffer: Map<string, any[]> = new Map();
  private alertHistory: Array<any> = [];
  private userSessions: Map<string, any> = new Map();
  private revenueData: Array<any> = [];
  private lastUpdate = Date.now();

  constructor() {
    super();
    this.initializeDataCollection();
    this.startRealtimeUpdates();
  }

  // Get complete dashboard data
  async getDashboardData(timeRange: {
    start: number;
    end: number;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  }): Promise<DashboardData> {
    const metrics = metricsCollector.getMetricsSnapshot();
    const businessMetrics = metricsCollector.getBusinessMetrics();
    const analytics = metricsCollector.getAnalytics(timeRange);

    return {
      overview: await this.getOverviewMetrics(),
      research: await this.getResearchMetrics(),
      performance: await this.getPerformanceMetrics(),
      business: businessMetrics,
      users: await this.getUserMetrics(),
      revenue: await this.getRevenueMetrics(),
      alerts: await this.getAlertMetrics(),
      realtime: await this.getRealtimeMetrics(),
    };
  }

  // Overview metrics calculation
  private async getOverviewMetrics(): Promise<OverviewMetrics> {
    const metrics = metricsCollector.getMetricsSnapshot();
    const businessMetrics = metricsCollector.getBusinessMetrics();
    const errorStats = errorTracker.getErrorStatistics();

    const uptime = process.uptime();
    const healthScore = this.calculateHealthScore(metrics, errorStats);

    return {
      totalQueries: businessMetrics.totalResearchQueries,
      successRate: (businessMetrics.successfulQueries / Math.max(1, businessMetrics.totalResearchQueries)) * 100,
      averageResponseTime: metrics.researchDuration,
      activeUsers: businessMetrics.uniqueActiveUsers,
      errorRate: metrics.errorRate * 100,
      uptime,
      healthScore,
    };
  }

  // Research-specific metrics
  private async getResearchMetrics(): Promise<ResearchMetrics> {
    const analytics = metricsCollector.getAnalytics({ start: Date.now() - 24*60*60*1000, end: Date.now() });
    const businessMetrics = metricsCollector.getBusinessMetrics();

    return {
      completionRate: businessMetrics.successfulQueries / Math.max(1, businessMetrics.totalResearchQueries) * 100,
      averageDuration: businessMetrics.averageResearchDuration,
      averageTokensPerQuery: this.getAverageTokensPerQuery(),
      averageSourcesPerQuery: this.getAverageSourcesPerQuery(),
      mostPopularTools: await this.getMostPopularTools(),
      queryComplexityDistribution: await this.getQueryComplexityDistribution(),
      timeToFirstResult: await this.getTimeToFirstResult(),
      userSatisfactionScore: businessMetrics.userSatisfactionScore,
    };
  }

  // Performance metrics
  private async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const analytics = metricsCollector.getAnalytics({ start: Date.now() - 60*60*1000, end: Date.now() });
    const systemMetrics = metricsCollector.getSystemMetrics();

    return {
      apiLatency: {
        p50: this.getPercentile('api.request_duration', 50),
        p95: this.getPercentile('api.request_duration', 95),
        p99: this.getPercentile('api.request_duration', 99),
      },
      systemResources: {
        cpuUsage: systemMetrics.cpu.usage,
        memoryUsage: systemMetrics.memory.percentage,
        diskUsage: systemMetrics.disk.usage,
      },
      externalAPIHealth: await this.getExternalAPIHealth(),
      connectionMetrics: {
        active: systemMetrics.network.activeConnections,
        peak: this.getPeakConnections(),
        averageDuration: this.getAverageConnectionDuration(),
      },
    };
  }

  // User metrics
  private async getUserMetrics(): Promise<UserMetrics> {
    const businessMetrics = metricsCollector.getBusinessMetrics();

    return {
      totalUsers: await this.getTotalUsers(),
      activeUsers: {
        daily: await this.getActiveUsers('day'),
        weekly: await this.getActiveUsers('week'),
        monthly: await this.getActiveUsers('month'),
      },
      userGrowth: await this.getUserGrowthData(),
      userEngagement: {
        averageSessionDuration: await this.getAverageSessionDuration(),
        queriesPerSession: await this.getQueriesPerSession(),
        returnRate: businessMetrics.retentionRate,
      },
      tierDistribution: await this.getTierDistribution(),
    };
  }

  // Revenue metrics
  private async getRevenueMetrics(): Promise<RevenueMetrics> {
    const businessMetrics = metricsCollector.getBusinessMetrics();

    return {
      totalRevenue: businessMetrics.totalRevenue,
      monthlyRecurringRevenue: await this.getMonthlyRecurringRevenue(),
      revenuePerUser: businessMetrics.totalRevenue / Math.max(1, businessMetrics.uniqueActiveUsers),
      costPerQuery: businessMetrics.costPerQuery,
      profitMargin: await this.getProfitMargin(),
      revenueGrowth: await this.getRevenueGrowthData(),
      topCustomers: await this.getTopCustomers(),
    };
  }

  // Alert metrics
  private async getAlertMetrics(): Promise<AlertMetrics> {
    return {
      activeAlerts: this.getActiveAlertsCount(),
      alertsByPriority: this.getAlertsByPriority(),
      recentIncidents: this.getRecentIncidents(),
      mttr: this.calculateMTTR(),
      mtbf: this.calculateMTBF(),
    };
  }

  // Real-time metrics
  private async getRealtimeMetrics(): Promise<RealtimeMetrics> {
    const systemMetrics = metricsCollector.getSystemMetrics();

    return {
      currentRPS: systemMetrics.network.requestsPerSecond,
      activeConnections: systemMetrics.network.activeConnections,
      queueLength: 0, // Would need to implement queue monitoring
      lastUpdated: Date.now(),
      trends: {
        requests: this.getRealtimeTrend('requests'),
        errors: this.getRealtimeTrend('errors'),
        latency: this.getRealtimeTrend('latency'),
      },
    };
  }

  // Health score calculation
  private calculateHealthScore(metrics: any, errorStats: any): number {
    let score = 100;
    
    // Deduct points for high error rate
    score -= Math.min(50, metrics.errorRate * 1000);
    
    // Deduct points for high memory usage
    score -= Math.min(20, Math.max(0, metrics.memoryUsage - 70));
    
    // Deduct points for high response time
    if (metrics.researchDuration > 30000) { // 30 seconds
      score -= Math.min(20, (metrics.researchDuration - 30000) / 1000);
    }
    
    // Deduct points for active alerts
    score -= Math.min(10, errorStats.recentAlerts);
    
    return Math.max(0, Math.round(score));
  }

  // Helper methods for metrics calculation
  private getPercentile(metricName: string, percentile: number): number {
    // This would interface with the metrics collector's histogram data
    return 0; // Placeholder
  }

  private async getExternalAPIHealth(): Promise<Array<{
    provider: string;
    status: 'healthy' | 'degraded' | 'down';
    latency: number;
    errorRate: number;
  }>> {
    return [
      { provider: 'OpenAI', status: 'healthy', latency: 250, errorRate: 0.1 },
      { provider: 'Tavily', status: 'healthy', latency: 180, errorRate: 0.05 },
      { provider: 'Pinecone', status: 'healthy', latency: 120, errorRate: 0.02 },
    ];
  }

  private getAverageTokensPerQuery(): number {
    // Calculate from historical data
    return 1250; // Placeholder
  }

  private getAverageSourcesPerQuery(): number {
    // Calculate from historical data
    return 3.2; // Placeholder
  }

  private async getMostPopularTools(): Promise<Array<{ name: string; usage: number }>> {
    return [
      { name: 'tavily_search', usage: 85 },
      { name: 'think_tool', usage: 70 },
      { name: 'save_to_memory', usage: 45 },
      { name: 'retrieve_from_memory', usage: 30 },
    ];
  }

  private async getQueryComplexityDistribution(): Promise<Array<{ complexity: string; count: number }>> {
    return [
      { complexity: 'Simple', count: 45 },
      { complexity: 'Medium', count: 35 },
      { complexity: 'Complex', count: 20 },
    ];
  }

  private async getTimeToFirstResult(): number {
    return 2800; // 2.8 seconds average
  }

  private getPeakConnections(): number {
    return 125; // Placeholder
  }

  private getAverageConnectionDuration(): number {
    return 180000; // 3 minutes average
  }

  private async getTotalUsers(): number {
    return 1250; // Placeholder
  }

  private async getActiveUsers(period: 'day' | 'week' | 'month'): Promise<number> {
    const periods = { day: 150, week: 450, month: 890 };
    return periods[period];
  }

  private async getUserGrowthData(): Promise<Array<{ date: string; newUsers: number; churnedUsers: number }>> {
    // Generate sample data for the last 30 days
    const data = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      data.push({
        date: date.toISOString().split('T')[0],
        newUsers: Math.floor(Math.random() * 20) + 5,
        churnedUsers: Math.floor(Math.random() * 5),
      });
    }
    return data;
  }

  private async getAverageSessionDuration(): number {
    return 1800000; // 30 minutes average
  }

  private async getQueriesPerSession(): number {
    return 2.3; // Average queries per session
  }

  private async getTierDistribution(): Promise<Array<{ tier: string; count: number; revenue: number }>> {
    return [
      { tier: 'free', count: 800, revenue: 0 },
      { tier: 'premium', count: 350, revenue: 3500 },
      { tier: 'enterprise', count: 100, revenue: 15000 },
    ];
  }

  private async getMonthlyRecurringRevenue(): number {
    return 18500; // $18,500 MRR
  }

  private async getProfitMargin(): number {
    return 65; // 65% profit margin
  }

  private async getRevenueGrowthData(): Promise<Array<{ month: string; revenue: number; growth: number }>> {
    // Generate sample data for the last 12 months
    const data = [];
    let baseRevenue = 10000;
    
    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      
      const revenue = baseRevenue + Math.floor(Math.random() * 2000);
      const growth = i === 11 ? 0 : ((revenue - baseRevenue) / baseRevenue) * 100;
      
      data.push({
        month: date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
        revenue,
        growth,
      });
      
      baseRevenue = revenue;
    }
    
    return data;
  }

  private async getTopCustomers(): Promise<Array<{ id: string; revenue: number; queries: number }>> {
    return [
      { id: 'customer_001', revenue: 2500, queries: 1250 },
      { id: 'customer_002', revenue: 1800, queries: 900 },
      { id: 'customer_003', revenue: 1500, queries: 750 },
      { id: 'customer_004', revenue: 1200, queries: 600 },
      { id: 'customer_005', revenue: 1000, queries: 500 },
    ];
  }

  private getActiveAlertsCount(): number {
    return this.alertHistory.filter(alert => !alert.resolved).length;
  }

  private getAlertsByPriority(): Record<string, number> {
    const alerts = this.alertHistory.filter(alert => !alert.resolved);
    const byPriority: Record<string, number> = {};
    
    alerts.forEach(alert => {
      byPriority[alert.severity] = (byPriority[alert.severity] || 0) + 1;
    });
    
    return byPriority;
  }

  private getRecentIncidents(): Array<any> {
    return this.alertHistory
      .filter(alert => Date.now() - alert.timestamp < 7 * 24 * 60 * 60 * 1000) // Last 7 days
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  }

  private calculateMTTR(): number {
    const resolvedIncidents = this.alertHistory.filter(alert => alert.resolved && alert.duration);
    if (resolvedIncidents.length === 0) return 0;
    
    const totalTime = resolvedIncidents.reduce((sum, incident) => sum + incident.duration!, 0);
    return totalTime / resolvedIncidents.length;
  }

  private calculateMTBF(): number {
    const incidents = this.alertHistory.filter(alert => alert.severity === 'critical');
    if (incidents.length < 2) return 0;
    
    incidents.sort((a, b) => a.timestamp - b.timestamp);
    let totalTimeBetween = 0;
    
    for (let i = 1; i < incidents.length; i++) {
      totalTimeBetween += incidents[i].timestamp - incidents[i-1].timestamp;
    }
    
    return totalTimeBetween / (incidents.length - 1);
  }

  private getRealtimeTrend(metric: string): Array<{ timestamp: number; count: number }> {
    const data = this.realtimeBuffer.get(metric) || [];
    return data.slice(-60); // Last 60 data points (1 hour at 1-minute intervals)
  }

  // Data collection initialization
  private initializeDataCollection(): void {
    // Listen to metrics events
    metricsCollector.on('research_completed', (event) => {
      this.recordResearchEvent(event);
    });

    metricsCollector.on('api_request', (event) => {
      this.recordAPIEvent(event);
    });

    metricsCollector.on('user_feedback', (event) => {
      this.recordUserEvent(event);
    });

    errorTracker.on('alert_sent', (alert) => {
      this.recordAlert(alert);
    });

    errorTracker.on('critical_error', (event) => {
      this.recordCriticalEvent(event);
    });
  }

  // Start real-time updates
  private startRealtimeUpdates(): void {
    setInterval(() => {
      this.updateRealtimeMetrics();
    }, 60000); // Every minute

    setInterval(() => {
      this.emit('dashboard_update', this.getDashboardData({
        start: Date.now() - 24*60*60*1000,
        end: Date.now(),
      }));
    }, 5000); // Every 5 seconds for real-time updates
  }

  private updateRealtimeMetrics(): void {
    const now = Date.now();
    const metrics = metricsCollector.getMetricsSnapshot();

    // Update trends
    this.appendToRealtimeBuffer('requests', { timestamp: now, count: metrics.researchDuration });
    this.appendToRealtimeBuffer('errors', { timestamp: now, count: metrics.errorRate });
    this.appendToRealtimeBuffer('latency', { timestamp: now, value: metrics.researchDuration });
  }

  private appendToRealtimeBuffer(key: string, data: any): void {
    const buffer = this.realtimeBuffer.get(key) || [];
    buffer.push(data);
    
    // Keep only last hour of data (60 points)
    if (buffer.length > 60) {
      buffer.shift();
    }
    
    this.realtimeBuffer.set(key, buffer);
  }

  // Event recording methods
  private recordResearchEvent(event: any): void {
    // Store research event for analytics
    const historical = this.historicalData.get('research') || [];
    historical.push(event);
    this.historicalData.set('research', historical);
  }

  private recordAPIEvent(event: any): void {
    // Store API event for analytics
    const historical = this.historicalData.get('api') || [];
    historical.push(event);
    this.historicalData.set('api', historical);
  }

  private recordUserEvent(event: any): void {
    // Store user event for analytics
    const historical = this.historicalData.get('users') || [];
    historical.push(event);
    this.historicalData.set('users', historical);
  }

  private recordAlert(alert: any): void {
    this.alertHistory.push({
      id: `alert_${Date.now()}`,
      type: alert.rule,
      severity: alert.severity,
      timestamp: Date.now(),
      resolved: false,
      description: alert.error.message,
    });
  }

  private recordCriticalEvent(event: any): void {
    this.alertHistory.push({
      id: `critical_${Date.now()}`,
      type: 'critical_error',
      severity: 'critical',
      timestamp: Date.now(),
      resolved: false,
      description: event.error.message,
    });
  }

  // Public API for external integrations
  async getCustomReport(config: {
    metrics: string[];
    timeRange: { start: number; end: number };
    filters?: Record<string, any>;
    groupBy?: string;
  }): Promise<any> {
    // Generate custom reports based on configuration
    const data = await this.getDashboardData(config.timeRange);
    
    // Apply filters and grouping
    return this.processCustomReport(data, config);
  }

  private processCustomReport(data: DashboardData, config: any): any {
    // Process data based on configuration
    return data; // Placeholder implementation
  }

  // Export data for external analytics tools
  async exportData(format: 'json' | 'csv', timeRange: { start: number; end: number }): Promise<string> {
    const data = await this.getDashboardData(timeRange);
    
    if (format === 'csv') {
      return this.convertToCSV(data);
    }
    
    return JSON.stringify(data, null, 2);
  }

  private convertToCSV(data: any): string {
    // Convert dashboard data to CSV format
    return 'CSV data placeholder';
  }
}

// Global dashboard instance
export const businessDashboard = new BusinessDashboard();

// Express route for dashboard API
export const createDashboardRoutes = (app: any) => {
  // Get dashboard data
  app.get('/api/dashboard', async (req: any, res: any) => {
    try {
      const timeRange = {
        start: parseInt(req.query.start) || Date.now() - 24*60*60*1000,
        end: parseInt(req.query.end) || Date.now(),
        granularity: req.query.granularity || 'hour',
      };
      
      const data = await businessDashboard.getDashboardData(timeRange);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });

  // Get real-time metrics
  app.get('/api/dashboard/realtime', async (req: any, res: any) => {
    try {
      const realtime = await businessDashboard.getRealtimeMetrics();
      res.json(realtime);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch real-time data' });
    }
  });

  // Custom reports
  app.post('/api/dashboard/report', async (req: any, res: any) => {
    try {
      const report = await businessDashboard.getCustomReport(req.body);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // Export data
  app.get('/api/dashboard/export', async (req: any, res: any) => {
    try {
      const format = req.query.format || 'json';
      const timeRange = {
        start: parseInt(req.query.start) || Date.now() - 24*60*60*1000,
        end: parseInt(req.query.end) || Date.now(),
      };
      
      const data = await businessDashboard.exportData(format, timeRange);
      
      const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
      const filename = `dashboard-export-${new Date().toISOString().split('T')[0]}.${format}`;
      
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to export data' });
    }
  });
};

export { DashboardData, OverviewMetrics, ResearchMetrics, PerformanceMetrics, UserMetrics, RevenueMetrics, AlertMetrics, RealtimeMetrics };