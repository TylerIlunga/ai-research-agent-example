import { Request, Response, NextFunction } from 'express';
import cors from 'cors';

// Environment-specific CORS configuration
const CORS_ORIGINS = {
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ],
  staging: [
    'https://staging.research-agent.com',
    'https://staging-api.research-agent.com',
  ],
  production: [
    'https://research-agent.com',
    'https://www.research-agent.com',
    'https://api.research-agent.com',
  ],
};

// Get allowed origins based on environment
function getAllowedOrigins(): string[] {
  const env = process.env.NODE_ENV || 'development';
  const customOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  
  const envOrigins = CORS_ORIGINS[env as keyof typeof CORS_ORIGINS] || CORS_ORIGINS.development;
  
  return [...envOrigins, ...customOrigins];
}

/**
 * In development the frontend's port is not ours to predict — the default may
 * already be taken by another project, and `next dev --port` moves it. Trust
 * any loopback origin locally; production stays on the explicit allowlist.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// Enhanced CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = getAllowedOrigins();
    const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';

    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin && isDevelopment) {
      return callback(null, true);
    }

    if (origin && isDevelopment && LOOPBACK_ORIGIN.test(origin)) {
      return callback(null, true);
    }

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS violation:', { origin, allowedOrigins });
      callback(new Error('Not allowed by CORS policy'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Session-ID',
    'X-Signature',
    'X-Timestamp',
    'X-Request-ID',
    'Accept',
    'User-Agent',
    'Cache-Control',
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Request-ID',
    'Retry-After',
  ],
  maxAge: 86400, // 24 hours preflight cache
};

// Content Security Policy configuration
const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'", // Required for some development tools
    'https://cdnjs.cloudflare.com',
    'https://cdn.jsdelivr.net',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'", // Required for styled-components and CSS-in-JS
    'https://fonts.googleapis.com',
  ],
  'font-src': [
    "'self'",
    'https://fonts.gstatic.com',
    'data:',
  ],
  'img-src': [
    "'self'",
    'data:',
    'https:',
    'blob:',
  ],
  'connect-src': [
    "'self'",
    'https://api.openai.com',
    'https://api.tavily.com',
    'wss:',
    'ws:',
  ],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'media-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'upgrade-insecure-requests': [],
};

// Generate CSP header value
function generateCSP(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, sources]) => {
      if (sources.length === 0) {
        return directive;
      }
      return `${directive} ${sources.join(' ')}`;
    })
    .join('; ');
}

// Security headers middleware
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Content Security Policy
  res.setHeader('Content-Security-Policy', generateCSP());
  
  // Strict Transport Security (HTTPS enforcement)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  
  // X-Frame-Options (prevent clickjacking)
  res.setHeader('X-Frame-Options', 'DENY');
  
  // X-Content-Type-Options (prevent MIME sniffing)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // X-XSS-Protection (legacy XSS protection)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy (formerly Feature Policy)
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );
  
  // Remove server fingerprinting headers
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Add custom security headers
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  
  // Request ID for tracing
  const requestId = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', requestId);
  (req as any).requestId = requestId;
  
  next();
}

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// HTTPS enforcement middleware
export function enforceHTTPS(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    
    if (proto !== 'https') {
      const httpsUrl = `https://${req.headers.host}${req.url}`;
      return res.redirect(301, httpsUrl);
    }
  }
  
  next();
}

// Security logging middleware
export function securityLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Log security-relevant information
  const securityContext = {
    requestId: (req as any).requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin,
    referer: req.headers.referer,
    timestamp: new Date().toISOString(),
  };
  
  // Log suspicious patterns
  const suspiciousIndicators = detectSuspiciousActivity(req);
  if (suspiciousIndicators.length > 0) {
    console.warn('Suspicious request detected:', {
      ...securityContext,
      indicators: suspiciousIndicators,
    });
  }
  
  // Override res.end to log response information
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const duration = Date.now() - startTime;
    
    // Log failed requests
    if (res.statusCode >= 400) {
      console.warn('Failed request:', {
        ...securityContext,
        statusCode: res.statusCode,
        duration,
      });
    }
    
    // Log successful authentication
    if (req.path.includes('/auth') && res.statusCode < 300) {
      console.info('Authentication success:', {
        ...securityContext,
        statusCode: res.statusCode,
        duration,
      });
    }
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
}

// Detect suspicious activity patterns
function detectSuspiciousActivity(req: Request): string[] {
  const indicators: string[] = [];
  const userAgent = req.headers['user-agent'] || '';
  const path = req.path.toLowerCase();
  
  // Common attack patterns in URLs
  const attackPatterns = [
    /\.\.\//, // Directory traversal
    /\/etc\/passwd/, // System file access
    /\/proc\//, // Process information
    /<script/, // XSS attempts
    /union.*select/i, // SQL injection
    /javascript:/i, // JavaScript injection
    /eval\(/i, // Code evaluation
    /document\.cookie/i, // Cookie theft
    /base64_decode/i, // Obfuscated payloads
  ];
  
  for (const pattern of attackPatterns) {
    if (pattern.test(path) || pattern.test(req.url || '')) {
      indicators.push(`Attack pattern in URL: ${pattern.toString()}`);
    }
  }
  
  // Suspicious User-Agent patterns
  const suspiciousUAs = [
    /sqlmap/i,
    /nikto/i,
    /nessus/i,
    /burp/i,
    /masscan/i,
    /nmap/i,
    /dirb/i,
    /dirbuster/i,
    /gobuster/i,
    /whatweb/i,
  ];
  
  for (const pattern of suspiciousUAs) {
    if (pattern.test(userAgent)) {
      indicators.push(`Suspicious User-Agent: ${pattern.toString()}`);
    }
  }
  
  // Check for rapid requests from same IP (basic rate limiting bypass detection)
  const recentRequests = getRecentRequestsForIP(req.ip || '');
  if (recentRequests > 100) { // More than 100 requests in last minute
    indicators.push('High request frequency');
  }
  
  // Check for missing required headers
  if (!req.headers['user-agent']) {
    indicators.push('Missing User-Agent header');
  }
  
  // Check for unusual HTTP methods on specific endpoints
  if (req.method === 'TRACE' || req.method === 'TRACK') {
    indicators.push('HTTP method not allowed');
  }
  
  return indicators;
}

// Simple request tracking for suspicious activity detection
const ipRequestCounts = new Map<string, { count: number; lastReset: number }>();

function getRecentRequestsForIP(ip: string): number {
  const now = Date.now();
  const data = ipRequestCounts.get(ip) || { count: 0, lastReset: now };
  
  // Reset counter every minute
  if (now - data.lastReset > 60000) {
    data.count = 0;
    data.lastReset = now;
  }
  
  data.count++;
  ipRequestCounts.set(ip, data);
  
  return data.count;
}

// IP geolocation and threat intelligence (placeholder)
export function threatIntelligence(req: Request, res: Response, next: NextFunction) {
  const clientIP = req.ip || '';
  
  // In production, integrate with threat intelligence services
  // like MaxMind, VirusTotal, AbuseIPDB, etc.
  
  // Check against known malicious IP lists
  const knownMaliciousIPs = process.env.BLOCKED_IPS?.split(',') || [];
  
  if (knownMaliciousIPs.includes(clientIP)) {
    console.error('Request from known malicious IP:', {
      ip: clientIP,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    
    return res.status(403).json({
      error: 'Access denied',
      code: 'IP_BLOCKED',
    });
  }
  
  // TODO: Implement real-time threat intelligence lookup
  // const threatLevel = await checkThreatIntelligence(clientIP);
  // if (threatLevel === 'high') {
  //   return res.status(403).json({ error: 'High-risk IP detected' });
  // }
  
  next();
}

// Security event monitoring
export class SecurityMonitor {
  private static events: Array<{
    type: string;
    details: any;
    timestamp: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> = [];

  static logEvent(type: string, details: any, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium') {
    this.events.push({
      type,
      details,
      timestamp: Date.now(),
      severity,
    });

    // Keep only last 10000 events
    if (this.events.length > 10000) {
      this.events = this.events.slice(-10000);
    }

    // Log high-severity events
    if (severity === 'high' || severity === 'critical') {
      console.error(`Security Event [${severity.toUpperCase()}]:`, {
        type,
        details,
        timestamp: new Date().toISOString(),
      });
    }

    // Trigger alerts for critical events
    if (severity === 'critical') {
      this.triggerCriticalAlert(type, details);
    }
  }

  static getEvents(since?: number): typeof SecurityMonitor.events {
    if (!since) return this.events;
    
    return this.events.filter(event => event.timestamp >= since);
  }

  static getEventsSummary(hours: number = 24) {
    const since = Date.now() - (hours * 60 * 60 * 1000);
    const recentEvents = this.getEvents(since);
    
    const summary = {
      total: recentEvents.length,
      bySeverity: {
        low: recentEvents.filter(e => e.severity === 'low').length,
        medium: recentEvents.filter(e => e.severity === 'medium').length,
        high: recentEvents.filter(e => e.severity === 'high').length,
        critical: recentEvents.filter(e => e.severity === 'critical').length,
      },
      byType: recentEvents.reduce((acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
    
    return summary;
  }

  private static triggerCriticalAlert(type: string, details: any) {
    // In production, this would:
    // - Send notifications to security team
    // - Trigger incident response
    // - Log to SIEM system
    // - Potentially auto-block threats
    
    console.error('CRITICAL SECURITY ALERT:', {
      type,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}

// Combined security middleware
export function applySecurity() {
  return [
    enforceHTTPS,
    cors(corsOptions),
    securityHeaders,
    threatIntelligence,
    securityLogger,
  ];
}

// Clean up old request tracking data periodically
setInterval(() => {
  const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
  for (const [ip, data] of ipRequestCounts.entries()) {
    if (data.lastReset < cutoff) {
      ipRequestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes