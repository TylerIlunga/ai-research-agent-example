import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

// Token bucket implementation
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private capacity: number;
  private refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  consume(tokens: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  getTimeUntilRefill(tokensNeeded: number = 1): number {
    this.refill();
    
    if (this.tokens >= tokensNeeded) {
      return 0;
    }
    
    const tokensShortfall = tokensNeeded - this.tokens;
    return Math.ceil(tokensShortfall / this.refillRate) * 1000; // milliseconds
  }
}

// Rate limiting configuration
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  refillRate: number; // requests per second
  keyGenerator?: (_req: Request) => string;
  skipRequest?: (_req: Request) => boolean;
  message?: string;
  statusCode?: number;
  headers?: boolean;
  onLimitReached?: (_req: Request, _identifier: string) => void;
}

// Different rate limiting tiers
export const RATE_LIMIT_CONFIGS = {
  global: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000,
    refillRate: 1000 / (60 * 60), // 1000 requests per hour
    message: 'Global rate limit exceeded',
  },
  perIP: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 100,
    refillRate: 100 / (60 * 60), // 100 requests per hour
    message: 'IP rate limit exceeded',
  },
  perUser: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50,
    refillRate: 50 / (60 * 60), // 50 requests per hour
    message: 'User rate limit exceeded',
  },
  research: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20,
    refillRate: 20 / (60 * 60), // 20 research queries per hour
    message: 'Research rate limit exceeded',
  },
  premium: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 200,
    refillRate: 200 / (60 * 60), // 200 requests per hour
    message: 'Premium rate limit exceeded',
  },
  enterprise: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000,
    refillRate: 1000 / (60 * 60), // 1000 requests per hour
    message: 'Enterprise rate limit exceeded',
  },
  apiKey: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 500,
    refillRate: 500 / (60 * 60), // 500 requests per hour
    message: 'API key rate limit exceeded',
  },
};

// Storage for token buckets
const tokenBuckets = new Map<string, TokenBucket>();
const rateLimitHits = new Map<string, {
  count: number;
  firstHit: number;
  lastHit: number;
}>();

// External API rate limiting (for Tavily, OpenAI, etc.)
class ExternalApiLimiter {
  private static buckets = new Map<string, TokenBucket>();
  
  static initializeService(serviceName: string, requestsPerSecond: number, burstCapacity: number = requestsPerSecond * 10) {
    this.buckets.set(serviceName, new TokenBucket(burstCapacity, requestsPerSecond));
  }
  
  static async waitForAvailability(serviceName: string, tokensNeeded: number = 1): Promise<boolean> {
    const bucket = this.buckets.get(serviceName);
    if (!bucket) {
      console.warn(`No rate limiter configured for service: ${serviceName}`);
      return true;
    }
    
    if (bucket.consume(tokensNeeded)) {
      return true;
    }
    
    const waitTime = bucket.getTimeUntilRefill(tokensNeeded);
    
    // Don't wait more than 30 seconds
    if (waitTime > 30000) {
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return bucket.consume(tokensNeeded);
  }
  
  static getStatus(serviceName: string) {
    const bucket = this.buckets.get(serviceName);
    if (!bucket) return null;
    
    return {
      tokensAvailable: bucket.getTokens(),
      nextRefillTime: bucket.getTimeUntilRefill(1),
    };
  }
}

// Initialize external API limiters
ExternalApiLimiter.initializeService('tavily', 10, 50); // 10 req/sec, burst 50
ExternalApiLimiter.initializeService('openai', 50, 100); // 50 req/sec, burst 100
ExternalApiLimiter.initializeService('pinecone', 20, 60); // 20 req/sec, burst 60

// Generic rate limiter factory
export function createRateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = config.keyGenerator ? config.keyGenerator(req) : req.ip || 'unknown';
    
    // Skip if configured to do so
    if (config.skipRequest && config.skipRequest(req)) {
      return next();
    }
    
    // Get or create token bucket
    const bucketKey = `${identifier}_${config.windowMs}_${config.maxRequests}`;
    let bucket = tokenBuckets.get(bucketKey);
    
    if (!bucket) {
      bucket = new TokenBucket(config.maxRequests, config.refillRate);
      tokenBuckets.set(bucketKey, bucket);
    }
    
    // Try to consume a token
    if (bucket.consume()) {
      // Add rate limit headers
      if (config.headers !== false) {
        res.setHeader('X-RateLimit-Limit', config.maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.floor(bucket.getTokens()));
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + config.windowMs).toISOString());
      }
      
      return next();
    }
    
    // Rate limit exceeded
    const retryAfter = Math.ceil(bucket.getTimeUntilRefill() / 1000);
    
    // Track rate limit hits for analysis
    const hitKey = `hits_${identifier}`;
    const hitData = rateLimitHits.get(hitKey) || { count: 0, firstHit: Date.now(), lastHit: 0 };
    hitData.count++;
    hitData.lastHit = Date.now();
    rateLimitHits.set(hitKey, hitData);
    
    // Call limit reached callback
    if (config.onLimitReached) {
      config.onLimitReached(req, identifier);
    }
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + config.windowMs).toISOString());
    res.setHeader('Retry-After', retryAfter);
    
    return res.status(config.statusCode || 429).json({
      error: config.message || 'Rate limit exceeded',
      retryAfter,
      code: 'RATE_LIMIT_EXCEEDED',
    });
  };
}

// Adaptive rate limiter based on user tier
export function createAdaptiveRateLimiter() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    let config = RATE_LIMIT_CONFIGS.perIP;
    
    // Determine rate limit based on authentication method and user tier
    if (req.apiKey) {
      config = {
        ...RATE_LIMIT_CONFIGS.apiKey,
        maxRequests: req.apiKey.rateLimits.requestsPerHour,
        refillRate: req.apiKey.rateLimits.requestsPerHour / (60 * 60),
      };
    } else if (req.user) {
      switch (req.user.tier) {
        case 'enterprise':
          config = RATE_LIMIT_CONFIGS.enterprise;
          break;
        case 'premium':
          config = RATE_LIMIT_CONFIGS.premium;
          break;
        case 'free':
        default:
          config = RATE_LIMIT_CONFIGS.perUser;
          break;
      }
    }
    
    // Create dynamic rate limiter
    const rateLimiter = createRateLimiter({
      ...config,
      keyGenerator: (req) => {
        if ((req as AuthenticatedRequest).apiKey) {
          return `api_${(req as AuthenticatedRequest).apiKey!.id}`;
        } else if ((req as AuthenticatedRequest).user) {
          return `user_${(req as AuthenticatedRequest).user!.id}`;
        } else {
          return `ip_${req.ip}`;
        }
      },
      onLimitReached: (req, _identifier) => {
        console.warn('Rate limit exceeded:', {
          identifier,
          path: req.path,
          method: req.method,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
          timestamp: new Date().toISOString(),
        });
      },
    });
    
    return rateLimiter(req, res, next);
  };
}

// Specific rate limiters
export const globalRateLimit = createRateLimiter({
  ...RATE_LIMIT_CONFIGS.global,
  keyGenerator: () => 'global',
});

export const ipRateLimit = createRateLimiter({
  ...RATE_LIMIT_CONFIGS.perIP,
  keyGenerator: (req) => `ip_${req.ip}`,
});

export const researchRateLimit = createRateLimiter({
  ...RATE_LIMIT_CONFIGS.research,
  keyGenerator: (req) => {
    const authReq = req as AuthenticatedRequest;
    if (authReq.user) {
      return `research_user_${authReq.user.id}`;
    } else if (authReq.apiKey) {
      return `research_api_${authReq.apiKey.id}`;
    } else {
      return `research_ip_${req.ip}`;
    }
  },
});

// Burst protection for SSE connections
export const sseConnectionLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 5, // Max 5 SSE connections per 5 minutes
  refillRate: 5 / (5 * 60), // 1 connection per minute
  keyGenerator: (req) => `sse_${req.ip}`,
  message: 'Too many SSE connections',
});

// DDoS protection
export const ddosProtection = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 100, // Max 100 requests per minute
  refillRate: 100 / 60, // ~1.67 requests per second
  keyGenerator: (req) => `ddos_${req.ip}`,
  message: 'Request rate too high - possible DDoS',
  onLimitReached: (req, _identifier) => {
    console.error('Potential DDoS detected:', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      path: req.path,
      timestamp: new Date().toISOString(),
    });
    
    // In production, trigger additional security measures:
    // - Temporarily block IP
    // - Alert security team
    // - Activate additional DDoS protection
  },
});

// External API rate limiting middleware
export function createExternalApiRateLimit(serviceName: string, tokensNeeded: number = 1) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const available = await ExternalApiLimiter.waitForAvailability(serviceName, tokensNeeded);
    
    if (!available) {
      return res.status(503).json({
        error: `${serviceName} service temporarily unavailable due to rate limits`,
        code: 'EXTERNAL_SERVICE_LIMITED',
      });
    }
    
    next();
  };
}

// Rate limit analytics
export function getRateLimitAnalytics() {
  const analytics = {
    totalBuckets: tokenBuckets.size,
    rateLimitHits: Array.from(rateLimitHits.entries()).map(([key, data]) => ({
      identifier: key,
      hitCount: data.count,
      firstHit: new Date(data.firstHit),
      lastHit: new Date(data.lastHit),
      duration: data.lastHit - data.firstHit,
    })),
    externalApiStatus: {
      tavily: ExternalApiLimiter.getStatus('tavily'),
      openai: ExternalApiLimiter.getStatus('openai'),
      pinecone: ExternalApiLimiter.getStatus('pinecone'),
    },
  };
  
  return analytics;
}

// Cleanup expired buckets and hit records
export function cleanupRateLimitData() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  // Clean up old hit records
  for (const [key, data] of rateLimitHits.entries()) {
    if (now - data.lastHit > maxAge) {
      rateLimitHits.delete(key);
    }
  }
  
  // Token buckets are automatically managed by their internal refill mechanism
  // but we could add cleanup logic here if needed
}

// Schedule cleanup every hour
setInterval(cleanupRateLimitData, 60 * 60 * 1000);

export { ExternalApiLimiter };