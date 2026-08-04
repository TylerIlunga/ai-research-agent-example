import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { EventEmitter } from 'events';
import { metricsCollector } from './metrics';

// Error classification interface
interface ErrorContext {
  user?: {
    id: string;
    tier: string;
    email?: string;
  };
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
    ip: string;
    userAgent: string;
  };
  research?: {
    sessionId: string;
    query: string;
    step: string;
    toolName?: string;
    tokensUsed?: number;
  };
  system?: {
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
  };
  metadata?: Record<string, any>;
}

interface AlertRule {
  name: string;
  condition: (error: Error, context: ErrorContext) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notification: {
    channels: ('email' | 'slack' | 'pagerduty')[];
    throttle: number; // minutes
  };
  action?: (error: Error, context: ErrorContext) => Promise<void>;
}

// Enhanced error tracking class
export class ErrorTracker extends EventEmitter {
  private alertRules: AlertRule[] = [];
  private alertHistory: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();
  private criticalErrors: Set<string> = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'TIMEOUT',
    'RATE_LIMIT_EXCEEDED',
    'API_KEY_INVALID',
    'INSUFFICIENT_FUNDS',
  ]);

  constructor() {
    super();
    this.initializeSentry();
    this.setupDefaultAlertRules();
    this.startErrorMonitoring();
  }

  private initializeSentry(): void {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.npm_package_version || '1.0.0',
      
      // Performance monitoring
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      
      integrations: [
        nodeProfilingIntegration(),
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app: undefined }),
        new Sentry.Integrations.OnUncaughtException({
          onFatalError: (error) => {
            console.error('Fatal error:', error);
            this.handleCriticalError(error, {});
          },
        }),
      ],

      // Enhanced error filtering
      beforeSend: (event, hint) => {
        const error = hint.originalException;
        
        // Filter out non-critical errors in production
        if (process.env.NODE_ENV === 'production') {
          if (error instanceof Error) {
            // Skip client disconnection errors
            if (error.message.includes('Client disconnected') ||
                error.message.includes('Connection closed') ||
                error.code === 'ECONNRESET') {
              return null;
            }
            
            // Skip rate limiting errors (they're expected)
            if (error.message.includes('Rate limit') && 
                event.level === 'warning') {
              return null;
            }
          }
        }

        // Add custom context
        if (event.contexts) {
          event.contexts.system = this.getSystemContext();
        }

        return event;
      },

      // Custom error tags
      initialScope: {
        tags: {
          component: 'ai-research-agent',
          version: process.env.npm_package_version || '1.0.0',
        },
      },
    });
  }

  // Track comprehensive error with context
  async trackError(error: Error, context: ErrorContext = {}): Promise<void> {
    const errorKey = this.generateErrorKey(error);
    const errorCount = (this.errorCounts.get(errorKey) || 0) + 1;
    this.errorCounts.set(errorKey, errorCount);

    // Enrich context with system information
    const enrichedContext: ErrorContext = {
      ...context,
      system: {
        ...context.system,
        ...this.getSystemContext(),
      },
    };

    // Set Sentry context
    Sentry.withScope((scope) => {
      // User context
      if (context.user) {
        scope.setUser({
          id: context.user.id,
          email: context.user.email,
          username: context.user.tier,
        });
      }

      // Request context
      if (context.request) {
        scope.setContext('request', {
          url: context.request.url,
          method: context.request.method,
          headers: this.sanitizeHeaders(context.request.headers),
          ip: context.request.ip,
          userAgent: context.request.userAgent,
        });
      }

      // Research context
      if (context.research) {
        scope.setContext('research', {
          sessionId: context.research.sessionId,
          query: context.research.query.substring(0, 200), // Limit query length
          step: context.research.step,
          toolName: context.research.toolName,
          tokensUsed: context.research.tokensUsed,
        });
      }

      // System context
      scope.setContext('system', enrichedContext.system);

      // Custom tags
      scope.setTag('error_type', error.constructor.name);
      scope.setTag('error_count', errorCount);
      
      if (context.research?.toolName) {
        scope.setTag('tool_name', context.research.toolName);
      }
      
      if (context.user?.tier) {
        scope.setTag('user_tier', context.user.tier);
      }

      // Additional metadata
      if (context.metadata) {
        scope.setContext('metadata', context.metadata);
      }

      // Set severity level
      const severity = this.determineSeverity(error, enrichedContext);
      scope.setLevel(severity);

      // Capture the error
      Sentry.captureException(error);
    });

    // Check alert rules
    await this.checkAlertRules(error, enrichedContext);

    // Update metrics
    metricsCollector.increment('errors.total');
    metricsCollector.increment(`errors.type.${error.constructor.name}`);
    
    if (context.research?.toolName) {
      metricsCollector.increment(`errors.tool.${context.research.toolName}`);
    }

    // Emit error event for other systems
    this.emit('error_tracked', {
      error,
      context: enrichedContext,
      severity,
      count: errorCount,
      timestamp: Date.now(),
    });
  }

  // Track API provider failures
  async trackAPIProviderError(provider: string, error: Error, context: {
    endpoint?: string;
    statusCode?: number;
    responseTime?: number;
    retryAttempt?: number;
  } = {}): Promise<void> {
    const enhancedError = new Error(`${provider} API Error: ${error.message}`);
    enhancedError.stack = error.stack;
    (enhancedError as any).provider = provider;
    (enhancedError as any).originalError = error;

    await this.trackError(enhancedError, {
      metadata: {
        provider,
        endpoint: context.endpoint,
        statusCode: context.statusCode,
        responseTime: context.responseTime,
        retryAttempt: context.retryAttempt,
        apiErrorType: 'provider_failure',
      },
    });

    // Track provider-specific metrics
    metricsCollector.increment(`api.${provider}.errors`);
    
    if (context.statusCode) {
      metricsCollector.increment(`api.${provider}.errors.${context.statusCode}`);
    }
  }

  // Track SSE connection drops
  async trackSSEConnectionDrop(sessionId: string, reason: string, context: {
    userId?: string;
    duration: number;
    messagesExchanged: number;
  }): Promise<void> {
    const error = new Error(`SSE Connection dropped: ${reason}`);
    (error as any).connectionType = 'sse';

    await this.trackError(error, {
      metadata: {
        sessionId,
        reason,
        duration: context.duration,
        messagesExchanged: context.messagesExchanged,
        errorType: 'sse_connection_drop',
      },
      user: context.userId ? { id: context.userId, tier: 'unknown' } : undefined,
    });

    metricsCollector.increment('sse.connection_drops');
  }

  // Track rate limit violations
  async trackRateLimitViolation(identifier: string, limitType: string, context: {
    currentRate: number;
    limit: number;
    userId?: string;
    ip: string;
  }): Promise<void> {
    const error = new Error(`Rate limit exceeded: ${limitType} for ${identifier}`);
    (error as any).rateLimitType = limitType;

    await this.trackError(error, {
      metadata: {
        identifier,
        limitType,
        currentRate: context.currentRate,
        limit: context.limit,
        ip: context.ip,
        errorType: 'rate_limit_violation',
      },
      user: context.userId ? { id: context.userId, tier: 'unknown' } : undefined,
    });

    metricsCollector.increment('rate_limit.violations');
    metricsCollector.increment(`rate_limit.violations.${limitType}`);
  }

  // Setup default alert rules
  private setupDefaultAlertRules(): void {
    // Critical system errors
    this.addAlertRule({
      name: 'critical_system_error',
      condition: (error, context) => {
        return this.criticalErrors.has(error.code || '') ||
               error.message.toLowerCase().includes('fatal') ||
               (context.system?.memoryUsage || 0) > 90;
      },
      severity: 'critical',
      notification: {
        channels: ['email', 'slack', 'pagerduty'],
        throttle: 5, // 5 minutes
      },
      action: async (error, context) => {
        await this.handleCriticalError(error, context);
      },
    });

    // High error rate
    this.addAlertRule({
      name: 'high_error_rate',
      condition: (error, context) => {
        const errorCount = this.errorCounts.get(this.generateErrorKey(error)) || 0;
        return errorCount > 10; // More than 10 occurrences of the same error
      },
      severity: 'high',
      notification: {
        channels: ['email', 'slack'],
        throttle: 15, // 15 minutes
      },
    });

    // API provider failures
    this.addAlertRule({
      name: 'api_provider_failure',
      condition: (error, context) => {
        return context.metadata?.apiErrorType === 'provider_failure' &&
               context.metadata?.statusCode >= 500;
      },
      severity: 'high',
      notification: {
        channels: ['slack'],
        throttle: 10, // 10 minutes
      },
    });

    // Research workflow failures
    this.addAlertRule({
      name: 'research_workflow_failure',
      condition: (error, context) => {
        return context.research && 
               error.message.toLowerCase().includes('research') &&
               !error.message.includes('timeout');
      },
      severity: 'medium',
      notification: {
        channels: ['slack'],
        throttle: 30, // 30 minutes
      },
    });

    // Authentication/authorization errors
    this.addAlertRule({
      name: 'auth_errors',
      condition: (error, context) => {
        return error.message.toLowerCase().includes('unauthorized') ||
               error.message.toLowerCase().includes('forbidden') ||
               error.message.toLowerCase().includes('authentication');
      },
      severity: 'medium',
      notification: {
        channels: ['slack'],
        throttle: 20, // 20 minutes
      },
    });
  }

  // Add custom alert rule
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
  }

  // Check alert rules against error
  private async checkAlertRules(error: Error, context: ErrorContext): Promise<void> {
    for (const rule of this.alertRules) {
      if (rule.condition(error, context)) {
        const alertKey = `${rule.name}_${this.generateErrorKey(error)}`;
        const lastAlertTime = this.lastAlertTimes.get(alertKey) || 0;
        const now = Date.now();
        
        // Check throttling
        if (now - lastAlertTime < rule.notification.throttle * 60 * 1000) {
          continue; // Skip this alert due to throttling
        }

        this.lastAlertTimes.set(alertKey, now);
        
        // Send alert
        await this.sendAlert(rule, error, context);
        
        // Execute custom action if defined
        if (rule.action) {
          try {
            await rule.action(error, context);
          } catch (actionError) {
            console.error('Alert action failed:', actionError);
          }
        }
      }
    }
  }

  // Send alert notification
  private async sendAlert(rule: AlertRule, error: Error, context: ErrorContext): Promise<void> {
    const alertData = {
      rule: rule.name,
      severity: rule.severity,
      error: {
        message: error.message,
        type: error.constructor.name,
        stack: error.stack,
      },
      context: this.sanitizeContext(context),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    };

    // Email notification
    if (rule.notification.channels.includes('email')) {
      await this.sendEmailAlert(alertData);
    }

    // Slack notification
    if (rule.notification.channels.includes('slack')) {
      await this.sendSlackAlert(alertData);
    }

    // PagerDuty notification
    if (rule.notification.channels.includes('pagerduty')) {
      await this.sendPagerDutyAlert(alertData);
    }

    this.emit('alert_sent', alertData);
  }

  // Handle critical errors
  private async handleCriticalError(error: Error, context: ErrorContext): Promise<void> {
    console.error('CRITICAL ERROR DETECTED:', error);
    
    // Log additional system information
    console.error('System State:', {
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(),
      activeHandles: (process as any)._getActiveHandles?.().length || 'unknown',
      activeRequests: (process as any)._getActiveRequests?.().length || 'unknown',
    });

    // In production, this could:
    // 1. Automatically restart the service
    // 2. Scale up additional instances
    // 3. Enable debug mode temporarily
    // 4. Capture heap dump for analysis
    
    this.emit('critical_error', { error, context });
  }

  // Utility methods
  private generateErrorKey(error: Error): string {
    return `${error.constructor.name}_${error.message.substring(0, 100)}`;
  }

  private determineSeverity(error: Error, context: ErrorContext): Sentry.SeverityLevel {
    if (this.criticalErrors.has(error.code || '') ||
        error.message.toLowerCase().includes('fatal') ||
        (context.system?.memoryUsage || 0) > 90) {
      return 'fatal';
    }
    
    if (error.message.toLowerCase().includes('timeout') ||
        (context.system?.memoryUsage || 0) > 75) {
      return 'error';
    }
    
    if (error.message.toLowerCase().includes('deprecated') ||
        error.message.toLowerCase().includes('warning')) {
      return 'warning';
    }
    
    return 'error';
  }

  private getSystemContext() {
    const memoryUsage = process.memoryUsage();
    return {
      memoryUsage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };
    
    // Remove sensitive headers
    delete sanitized.authorization;
    delete sanitized['x-api-key'];
    delete sanitized.cookie;
    delete sanitized['x-signature'];
    
    return sanitized;
  }

  private sanitizeContext(context: ErrorContext): any {
    const sanitized = { ...context };
    
    // Remove sensitive information
    if (sanitized.user?.email) {
      sanitized.user.email = sanitized.user.email.replace(/(.{2}).*(@.*)/, '$1***$2');
    }
    
    if (sanitized.request?.headers) {
      sanitized.request.headers = this.sanitizeHeaders(sanitized.request.headers);
    }
    
    if (sanitized.request?.body) {
      sanitized.request.body = '[REDACTED]';
    }
    
    return sanitized;
  }

  // Notification methods (implement based on your infrastructure)
  private async sendEmailAlert(alertData: any): Promise<void> {
    // Implement email sending logic
    console.log('EMAIL ALERT:', JSON.stringify(alertData, null, 2));
  }

  private async sendSlackAlert(alertData: any): Promise<void> {
    // Implement Slack notification logic
    console.log('SLACK ALERT:', JSON.stringify(alertData, null, 2));
  }

  private async sendPagerDutyAlert(alertData: any): Promise<void> {
    // Implement PagerDuty notification logic
    console.log('PAGERDUTY ALERT:', JSON.stringify(alertData, null, 2));
  }

  // Start error monitoring
  private startErrorMonitoring(): void {
    // Monitor error trends
    setInterval(() => {
      const totalErrors = Array.from(this.errorCounts.values())
        .reduce((sum, count) => sum + count, 0);
      
      metricsCollector.recordHistogram('errors.total_per_interval', totalErrors);
      
      // Reset error counts every hour
      this.errorCounts.clear();
    }, 60 * 60 * 1000); // Every hour

    // Clean up old alert history
    setInterval(() => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
      for (const [key, time] of this.lastAlertTimes.entries()) {
        if (time < cutoff) {
          this.lastAlertTimes.delete(key);
        }
      }
    }, 4 * 60 * 60 * 1000); // Every 4 hours
  }

  // Get error statistics
  getErrorStatistics() {
    return {
      totalErrors: Array.from(this.errorCounts.values())
        .reduce((sum, count) => sum + count, 0),
      uniqueErrors: this.errorCounts.size,
      criticalErrorTypes: Array.from(this.criticalErrors),
      recentAlerts: this.lastAlertTimes.size,
      alertRules: this.alertRules.length,
    };
  }
}

// Global error tracker instance
export const errorTracker = new ErrorTracker();

// Express error handling middleware
export const errorHandlingMiddleware = (error: Error, req: any, res: any, next: any) => {
  const context: ErrorContext = {
    request: {
      url: req.url,
      method: req.method,
      headers: req.headers,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
      body: req.body,
    },
    user: req.user ? {
      id: req.user.id,
      tier: req.user.tier,
      email: req.user.email,
    } : undefined,
    research: req.sessionId ? {
      sessionId: req.sessionId,
      query: req.body?.query || '',
      step: 'unknown',
    } : undefined,
  };

  errorTracker.trackError(error, context);
  next(error);
};

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  errorTracker.trackError(error, {
    metadata: {
      type: 'unhandled_rejection',
      promise: promise.toString(),
    },
  });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  errorTracker.trackError(error, {
    metadata: {
      type: 'uncaught_exception',
      fatal: true,
    },
  });
  
  // Give time for error to be reported
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

export { ErrorContext, AlertRule };