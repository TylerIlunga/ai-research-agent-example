import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
// import { z } from 'zod'; // Reserved for future validation schemas

// Encryption configuration
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_DERIVATION_SALT = process.env.KEY_DERIVATION_SALT || crypto.randomBytes(32).toString('hex');
const MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// API Key structure
interface ApiKeyData {
  id: string;
  name: string;
  hashedKey: string;
  encryptedKey?: string; // For backup/recovery purposes
  scopes: string[];
  rateLimits: {
    requestsPerHour: number;
    requestsPerDay: number;
    requestsPerMonth: number;
  };
  metadata: {
    createdAt: number;
    createdBy: string;
    lastUsed: number;
    totalRequests: number;
    environment: 'development' | 'staging' | 'production';
    ipWhitelist?: string[];
    expiresAt?: number;
  };
  rotationSchedule: {
    enabled: boolean;
    intervalDays: number;
    nextRotation?: number;
    rotationHistory: {
      rotatedAt: number;
      previousKeyHash: string;
      reason: string;
    }[];
  };
  isActive: boolean;
  isCompromised: boolean;
}

// Fallback key configuration
interface FallbackKeyConfig {
  id: string;
  priority: number;
  rateLimits: {
    requestsPerHour: number;
    requestsPerDay: number;
  };
  isActive: boolean;
}

// Key storage (use encrypted database in production)
const apiKeyStore = new Map<string, ApiKeyData>();
const fallbackKeys = new Map<string, FallbackKeyConfig>();
const keyUsageAudit = new Map<string, {
  timestamp: number;
  endpoint: string;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  errorCode?: string;
}[]>();

// Encryption utilities
class EncryptionManager {
  private static deriveKey(salt: string): Buffer {
    return crypto.pbkdf2Sync(MASTER_KEY, salt, 100000, 32, 'sha512');
  }

  static encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const key = this.deriveKey(KEY_DERIVATION_SALT);
    const cipher = crypto.createCipherGCM(ENCRYPTION_ALGORITHM, key);
    
    cipher.setAAD(Buffer.from(KEY_DERIVATION_SALT));
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  static decrypt(encryptedData: { encrypted: string; iv: string; tag: string }): string {
    const key = this.deriveKey(KEY_DERIVATION_SALT);
    const decipher = crypto.createDecipherGCM(ENCRYPTION_ALGORITHM, key);
    
    decipher.setAAD(Buffer.from(KEY_DERIVATION_SALT));
    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// API Key Management Class
export class ApiKeyManager {
  private static readonly KEY_PREFIX = 'ak_';
  private static readonly KEY_LENGTH = 64;

  static generateSecureKey(): { keyId: string; apiKey: string; hashedKey: string } {
    const keyId = crypto.randomUUID();
    const randomBytes = crypto.randomBytes(this.KEY_LENGTH);
    const apiKey = `${this.KEY_PREFIX}${randomBytes.toString('hex')}`;
    const hashedKey = crypto.createHash('sha512').update(apiKey).digest('hex');
    
    return { keyId, apiKey, hashedKey };
  }

  static createApiKey(config: {
    name: string;
    scopes: string[];
    rateLimits: {
      requestsPerHour: number;
      requestsPerDay: number;
      requestsPerMonth: number;
    };
    createdBy: string;
    environment: 'development' | 'staging' | 'production';
    ipWhitelist?: string[];
    expiresAt?: number;
    rotationEnabled?: boolean;
    rotationIntervalDays?: number;
  }): { keyId: string; apiKey: string } {
    const { keyId, apiKey, hashedKey } = this.generateSecureKey();
    const encryptedKeyData = EncryptionManager.encrypt(apiKey);
    
    const keyData: ApiKeyData = {
      id: keyId,
      name: config.name,
      hashedKey,
      encryptedKey: JSON.stringify(encryptedKeyData),
      scopes: config.scopes,
      rateLimits: config.rateLimits,
      metadata: {
        createdAt: Date.now(),
        createdBy: config.createdBy,
        lastUsed: 0,
        totalRequests: 0,
        environment: config.environment,
        ipWhitelist: config.ipWhitelist,
        expiresAt: config.expiresAt,
      },
      rotationSchedule: {
        enabled: config.rotationEnabled || false,
        intervalDays: config.rotationIntervalDays || 90,
        rotationHistory: [],
      },
      isActive: true,
      isCompromised: false,
    };

    // Schedule automatic rotation if enabled
    if (keyData.rotationSchedule.enabled) {
      const rotationInterval = keyData.rotationSchedule.intervalDays * 24 * 60 * 60 * 1000;
      keyData.rotationSchedule.nextRotation = Date.now() + rotationInterval;
    }

    apiKeyStore.set(keyId, keyData);
    keyUsageAudit.set(keyId, []);

    // Log key creation
    console.info('API key created:', {
      keyId,
      name: config.name,
      scopes: config.scopes,
      environment: config.environment,
      createdBy: config.createdBy,
    });

    return { keyId, apiKey };
  }

  static validateApiKey(apiKey: string, ipAddress?: string): ApiKeyData | null {
    const hashedKey = crypto.createHash('sha512').update(apiKey).digest('hex');
    
    for (const [keyId, keyData] of apiKeyStore.entries()) {
      if (keyData.hashedKey === hashedKey && keyData.isActive && !keyData.isCompromised) {
        // Check expiration
        if (keyData.metadata.expiresAt && Date.now() > keyData.metadata.expiresAt) {
          keyData.isActive = false;
          console.warn('API key expired:', { keyId, name: keyData.name });
          return null;
        }

        // Check IP whitelist
        if (keyData.metadata.ipWhitelist && ipAddress) {
          if (!keyData.metadata.ipWhitelist.includes(ipAddress)) {
            console.warn('API key access denied - IP not whitelisted:', {
              keyId,
              ipAddress,
              whitelist: keyData.metadata.ipWhitelist,
            });
            return null;
          }
        }

        // Update usage statistics
        keyData.metadata.lastUsed = Date.now();
        keyData.metadata.totalRequests++;

        return keyData;
      }
    }

    return null;
  }

  static rotateApiKey(keyId: string, reason: string = 'manual'): { newApiKey: string } | null {
    const existingKey = apiKeyStore.get(keyId);
    if (!existingKey) return null;

    const { apiKey: newApiKey, hashedKey: newHashedKey } = this.generateSecureKey();
    const encryptedKeyData = EncryptionManager.encrypt(newApiKey);

    // Store rotation history
    existingKey.rotationSchedule.rotationHistory.push({
      rotatedAt: Date.now(),
      previousKeyHash: existingKey.hashedKey,
      reason,
    });

    // Update key data
    existingKey.hashedKey = newHashedKey;
    existingKey.encryptedKey = JSON.stringify(encryptedKeyData);

    // Schedule next rotation if enabled
    if (existingKey.rotationSchedule.enabled) {
      const rotationInterval = existingKey.rotationSchedule.intervalDays * 24 * 60 * 60 * 1000;
      existingKey.rotationSchedule.nextRotation = Date.now() + rotationInterval;
    }

    console.info('API key rotated:', {
      keyId,
      name: existingKey.name,
      reason,
      timestamp: new Date().toISOString(),
    });

    return { newApiKey };
  }

  static revokeApiKey(keyId: string, reason: string = 'manual'): boolean {
    const keyData = apiKeyStore.get(keyId);
    if (!keyData) return false;

    keyData.isActive = false;

    console.info('API key revoked:', {
      keyId,
      name: keyData.name,
      reason,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  static markAsCompromised(keyId: string, reason: string): boolean {
    const keyData = apiKeyStore.get(keyId);
    if (!keyData) return false;

    keyData.isCompromised = true;
    keyData.isActive = false;

    console.error('API key marked as compromised:', {
      keyId,
      name: keyData.name,
      reason,
      timestamp: new Date().toISOString(),
    });

    // Trigger security alerts
    this.triggerSecurityAlert(keyId, reason);

    return true;
  }

  static getKeyDetails(keyId: string): Omit<ApiKeyData, 'hashedKey' | 'encryptedKey'> | null {
    const keyData = apiKeyStore.get(keyId);
    if (!keyData) return null;

    const { hashedKey: _, encryptedKey: __, ...safeKeyData } = keyData;
    return safeKeyData;
  }

  static listKeys(environment?: string): Array<Omit<ApiKeyData, 'hashedKey' | 'encryptedKey'>> {
    const keys = Array.from(apiKeyStore.values());
    
    let filteredKeys = keys;
    if (environment) {
      filteredKeys = keys.filter(key => key.metadata.environment === environment);
    }

    return filteredKeys.map(({ hashedKey: _, encryptedKey: __, ...safeKeyData }) => safeKeyData);
  }

  static auditKeyUsage(keyId: string, details: {
    endpoint: string;
    ipAddress: string;
    userAgent: string;
    success: boolean;
    errorCode?: string;
  }): void {
    const auditLog = keyUsageAudit.get(keyId) || [];
    
    auditLog.push({
      timestamp: Date.now(),
      ...details,
    });

    // Keep only last 1000 audit entries per key
    if (auditLog.length > 1000) {
      auditLog.splice(0, auditLog.length - 1000);
    }

    keyUsageAudit.set(keyId, auditLog);
  }

  static getUsageStatistics(keyId: string, days: number = 7) {
    const auditLog = keyUsageAudit.get(keyId) || [];
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    const recentEntries = auditLog.filter(entry => entry.timestamp >= since);
    
    return {
      totalRequests: recentEntries.length,
      successfulRequests: recentEntries.filter(entry => entry.success).length,
      failedRequests: recentEntries.filter(entry => !entry.success).length,
      uniqueIPs: new Set(recentEntries.map(entry => entry.ipAddress)).size,
      topEndpoints: this.getTopEndpoints(recentEntries),
      errorCodes: this.getErrorCodeDistribution(recentEntries),
    };
  }

  private static getTopEndpoints(entries: any[]): Array<{ endpoint: string; count: number }> {
    const endpointCounts = entries.reduce((acc, entry) => {
      acc[entry.endpoint] = (acc[entry.endpoint] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(endpointCounts)
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private static getErrorCodeDistribution(entries: any[]): Array<{ code: string; count: number }> {
    const errorCounts = entries
      .filter(entry => !entry.success && entry.errorCode)
      .reduce((acc, entry) => {
        acc[entry.errorCode!] = (acc[entry.errorCode!] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return Object.entries(errorCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);
  }

  private static triggerSecurityAlert(keyId: string, reason: string): void {
    // In production, this would:
    // - Send notifications to security team
    // - Log to security monitoring system
    // - Trigger additional security measures
    console.error('SECURITY ALERT: API Key Compromise', {
      keyId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  // Automatic rotation checker
  static checkPendingRotations(): void {
    const now = Date.now();
    
    for (const [keyId, keyData] of apiKeyStore.entries()) {
      if (
        keyData.rotationSchedule.enabled &&
        keyData.rotationSchedule.nextRotation &&
        now >= keyData.rotationSchedule.nextRotation &&
        keyData.isActive &&
        !keyData.isCompromised
      ) {
        this.rotateApiKey(keyId, 'automatic');
      }
    }
  }
}

// Fallback key management
export class FallbackKeyManager {
  static addFallbackKey(config: {
    serviceName: string;
    priority: number;
    rateLimits: {
      requestsPerHour: number;
      requestsPerDay: number;
    };
  }): string {
    const keyId = crypto.randomUUID();
    
    fallbackKeys.set(keyId, {
      id: keyId,
      priority: config.priority,
      rateLimits: config.rateLimits,
      isActive: true,
    });

    return keyId;
  }

  static getFallbackKey(excludeKeys: string[] = []): FallbackKeyConfig | null {
    const availableKeys = Array.from(fallbackKeys.values())
      .filter(key => key.isActive && !excludeKeys.includes(key.id))
      .sort((a, b) => a.priority - b.priority);

    return availableKeys[0] || null;
  }

  static deactivateFallbackKey(keyId: string): boolean {
    const key = fallbackKeys.get(keyId);
    if (key) {
      key.isActive = false;
      return true;
    }
    return false;
  }
}

// Middleware for API key validation
export function validateApiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  const clientIp = req.ip || req.connection.remoteAddress || '';

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      code: 'MISSING_API_KEY',
    });
  }

  const keyData = ApiKeyManager.validateApiKey(apiKey, clientIp);
  
  if (!keyData) {
    // Audit failed attempt
    const hashedKey = crypto.createHash('sha512').update(apiKey).digest('hex');
    console.warn('Invalid API key attempt:', {
      hashedKeyPrefix: hashedKey.substring(0, 8),
      ipAddress: clientIp,
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
    });

    return res.status(403).json({
      error: 'Invalid API key',
      code: 'INVALID_API_KEY',
    });
  }

  // Audit successful usage
  ApiKeyManager.auditKeyUsage(keyData.id, {
    endpoint: req.path,
    ipAddress: clientIp,
    userAgent: req.headers['user-agent'] || '',
    success: true,
  });

  // Attach key data to request
  (req as any).apiKeyData = keyData;

  next();
}

// Schedule automatic rotation checks (every hour)
// unref: a maintenance timer must not hold the process (or jest) open.
setInterval(ApiKeyManager.checkPendingRotations, 60 * 60 * 1000).unref();

export { ApiKeyData, FallbackKeyConfig };