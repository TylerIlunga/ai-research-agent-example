import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';

// Enhanced request interface with security context
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tier: 'free' | 'premium' | 'enterprise';
    permissions: string[];
  };
  sessionId?: string;
  apiKey?: {
    id: string;
    name: string;
    scopes: string[];
    rateLimits: {
      requestsPerHour: number;
      requestsPerDay: number;
    };
  };
  requestSignature?: string;
}

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

// Session storage (use Redis in production)
const activeSessions = new Map<string, {
  userId: string;
  createdAt: number;
  lastActivity: number;
  ipAddress: string;
  userAgent: string;
}>();

// API key storage (use encrypted database in production)
const apiKeys = new Map<string, {
  id: string;
  name: string;
  hashedKey: string;
  scopes: string[];
  rateLimits: {
    requestsPerHour: number;
    requestsPerDay: number;
  };
  createdAt: number;
  lastUsed: number;
  isActive: boolean;
}>();

// Validation schemas
const AuthTokenSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  tier: z.enum(['free', 'premium', 'enterprise']),
  permissions: z.array(z.string()),
  iat: z.number(),
  exp: z.number(),
});

const RefreshTokenSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  iat: z.number(),
  exp: z.number(),
});

// JWT utilities
export class JWTManager {
  static generateTokenPair(user: {
    id: string;
    email: string;
    tier: 'free' | 'premium' | 'enterprise';
    permissions: string[];
  }, sessionId: string) {
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        tier: user.tier,
        permissions: user.permissions,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
        sessionId,
      },
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN } as jwt.SignOptions
    );

    return { accessToken, refreshToken };
  }

  static verifyAccessToken(token: string): z.infer<typeof AuthTokenSchema> | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return AuthTokenSchema.parse(decoded);
    } catch (error) {
      console.error('JWT verification failed:', error);
      return null;
    }
  }

  static verifyRefreshToken(token: string): z.infer<typeof RefreshTokenSchema> | null {
    try {
      const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as any;
      return RefreshTokenSchema.parse(decoded);
    } catch (error) {
      console.error('Refresh token verification failed:', error);
      return null;
    }
  }

  static revokeToken(_token: string): void {
    // In production, maintain a blacklist in Redis
    // For now, we'll rely on short token expiry
  }
}

// Session management
export class SessionManager {
  static createSession(userId: string, ipAddress: string, userAgent: string): string {
    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, {
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      ipAddress,
      userAgent,
    });
    return sessionId;
  }

  static validateSession(sessionId: string, ipAddress: string): boolean {
    const session = activeSessions.get(sessionId);
    if (!session) return false;

    // Check session expiry (24 hours)
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
      activeSessions.delete(sessionId);
      return false;
    }

    // Update last activity
    session.lastActivity = Date.now();

    // Optional: Strict IP validation
    if (process.env.STRICT_IP_VALIDATION === 'true' && session.ipAddress !== ipAddress) {
      return false;
    }

    return true;
  }

  static destroySession(sessionId: string): void {
    activeSessions.delete(sessionId);
  }

  static cleanupExpiredSessions(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [sessionId, session] of activeSessions.entries()) {
      if (now - session.lastActivity > maxAge) {
        activeSessions.delete(sessionId);
      }
    }
  }
}

// API key management
export class ApiKeyManager {
  static generateApiKey(): { keyId: string; apiKey: string; hashedKey: string } {
    const keyId = crypto.randomUUID();
    const apiKey = `ak_${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    return { keyId, apiKey, hashedKey };
  }

  static storeApiKey(keyData: {
    id: string;
    name: string;
    hashedKey: string;
    scopes: string[];
    rateLimits: {
      requestsPerHour: number;
      requestsPerDay: number;
    };
  }): void {
    apiKeys.set(keyData.id, {
      ...keyData,
      createdAt: Date.now(),
      lastUsed: 0,
      isActive: true,
    });
  }

  static validateApiKey(apiKey: string): typeof apiKeys extends Map<string, infer V> ? V | null : null {
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    for (const [, keyData] of apiKeys.entries()) {
      if (keyData.hashedKey === hashedKey && keyData.isActive) {
        keyData.lastUsed = Date.now();
        return keyData;
      }
    }
    
    return null;
  }

  static revokeApiKey(keyId: string): boolean {
    const keyData = apiKeys.get(keyId);
    if (keyData) {
      keyData.isActive = false;
      return true;
    }
    return false;
  }

  static rotateApiKey(keyId: string): { apiKey: string } | null {
    const existingKey = apiKeys.get(keyId);
    if (!existingKey) return null;

    const { apiKey, hashedKey } = this.generateApiKey();
    existingKey.hashedKey = hashedKey;
    existingKey.lastUsed = 0;

    return { apiKey };
  }
}

// Request signing for sensitive operations
export class RequestSigner {
  private static SECRET_KEY = process.env.REQUEST_SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

  static signRequest(method: string, path: string, body: any, timestamp: number): string {
    const payload = `${method.toUpperCase()}|${path}|${JSON.stringify(body)}|${timestamp}`;
    return crypto
      .createHmac('sha256', this.SECRET_KEY)
      .update(payload)
      .digest('hex');
  }

  static verifySignature(
    method: string,
    path: string,
    body: any,
    timestamp: number,
    signature: string,
    maxAge: number = 300000 // 5 minutes
  ): boolean {
    // Check timestamp to prevent replay attacks
    if (Date.now() - timestamp > maxAge) {
      return false;
    }

    const expectedSignature = this.signRequest(method, path, body, timestamp);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}

// Authentication middleware
export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Access token required',
      code: 'MISSING_TOKEN'
    });
  }

  const decoded = JWTManager.verifyAccessToken(token);
  if (!decoded) {
    return res.status(403).json({ 
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }

  req.user = {
    id: decoded.userId,
    email: decoded.email,
    tier: decoded.tier,
    permissions: decoded.permissions,
  };

  next();
};

// API key authentication middleware
export const authenticateApiKey = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ 
      error: 'API key required',
      code: 'MISSING_API_KEY'
    });
  }

  const keyData = ApiKeyManager.validateApiKey(apiKey);
  if (!keyData) {
    return res.status(403).json({ 
      error: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
  }

  req.apiKey = {
    id: keyData.id,
    name: keyData.name,
    scopes: keyData.scopes,
    rateLimits: keyData.rateLimits,
  };

  next();
};

// Session validation middleware for SSE
export const validateSession = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const sessionId = req.headers['x-session-id'] as string;
  const clientIp = req.ip || req.connection.remoteAddress || '';

  if (!sessionId) {
    return res.status(401).json({ 
      error: 'Session ID required for SSE connections',
      code: 'MISSING_SESSION'
    });
  }

  if (!SessionManager.validateSession(sessionId, clientIp)) {
    return res.status(403).json({ 
      error: 'Invalid or expired session',
      code: 'INVALID_SESSION'
    });
  }

  req.sessionId = sessionId;
  next();
};

// Permission-based authorization
export const requirePermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    if (!req.user.permissions.includes(permission) && !req.user.permissions.includes('admin')) {
      return res.status(403).json({ 
        error: `Permission '${permission}' required`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

// Request signature validation for sensitive operations
export const validateSignature = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const signature = req.headers['x-signature'] as string;
  const timestamp = parseInt(req.headers['x-timestamp'] as string);

  if (!signature || !timestamp) {
    return res.status(400).json({ 
      error: 'Request signature and timestamp required',
      code: 'MISSING_SIGNATURE'
    });
  }

  const isValid = RequestSigner.verifySignature(
    req.method,
    req.path,
    req.body,
    timestamp,
    signature
  );

  if (!isValid) {
    return res.status(403).json({ 
      error: 'Invalid request signature',
      code: 'INVALID_SIGNATURE'
    });
  }

  req.requestSignature = signature;
  next();
};

// Combined authentication middleware (supports both JWT and API key)
export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'] as string;

  if (authHeader) {
    return authenticateToken(req, res, next);
  } else if (apiKey) {
    return authenticateApiKey(req, res, next);
  } else {
    return res.status(401).json({ 
      error: 'Authentication required (Bearer token or API key)',
      code: 'AUTHENTICATION_REQUIRED'
    });
  }
};

// Cleanup expired sessions periodically
// unref: a maintenance timer must not hold the process (or jest) open.
setInterval(SessionManager.cleanupExpiredSessions, 60 * 60 * 1000).unref(); // Every hour