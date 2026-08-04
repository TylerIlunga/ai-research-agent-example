import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import validator from 'validator';

// Request schemas
export const ResearchRequestSchema = z.object({
  query: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(500, 'Query must not exceed 500 characters')
    .transform((val) => sanitizeQuery(val)),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
  sources: z
    .number()
    .int('Sources must be an integer')
    .min(1, 'Minimum 1 source required')
    .max(20, 'Maximum 20 sources allowed')
    .default(5),
  includeMemory: z.boolean().default(true),
  sessionId: z
    .string()
    .uuid('Invalid session ID format')
    .optional(),
  conversationId: z
    .string()
    .uuid('Invalid conversation ID format')
    .optional(),
});

export const StreamRequestSchema = z.object({
  query: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(500, 'Query must not exceed 500 characters')
    .transform((val) => sanitizeQuery(val)),
  conversationId: z
    .string()
    .uuid('Invalid conversation ID format')
    .optional(),
});

export const ApiKeyCreateSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Name contains invalid characters'),
  scopes: z
    .array(z.enum(['research', 'admin', 'read', 'write']))
    .min(1, 'At least one scope is required'),
  rateLimits: z.object({
    requestsPerHour: z.number().int().min(1).max(10000),
    requestsPerDay: z.number().int().min(1).max(100000),
  }),
});

export const UserRegistrationSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .max(254, 'Email too long')
    .transform((val) => validator.normalizeEmail(val) || val),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      'Password must contain uppercase, lowercase, number, and special character'
    ),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .transform((val) => DOMPurify.sanitize(val.trim())),
});

// Dangerous patterns for prompt injection detection
const PROMPT_INJECTION_PATTERNS = [
  // Direct prompt manipulation
  /ignore\s+previous\s+instructions/i,
  /forget\s+your\s+previous\s+instructions/i,
  /disregard\s+the\s+above/i,
  /you\s+are\s+now\s+a\s+different/i,
  /act\s+as\s+if\s+you\s+are/i,
  /pretend\s+to\s+be/i,
  /roleplay\s+as/i,
  
  // System prompt extraction attempts
  /what\s+are\s+your\s+instructions/i,
  /show\s+me\s+your\s+prompt/i,
  /display\s+your\s+system\s+message/i,
  /reveal\s+your\s+guidelines/i,
  
  // Code injection attempts
  /<script[^>]*>/i,
  /javascript:/i,
  /eval\s*\(/i,
  /setTimeout\s*\(/i,
  /setInterval\s*\(/i,
  
  // SQL injection patterns
  /union\s+select/i,
  /drop\s+table/i,
  /delete\s+from/i,
  /insert\s+into/i,
  /update\s+set/i,
  
  // Command injection
  /;\s*cat\s+/i,
  /;\s*ls\s+/i,
  /;\s*rm\s+/i,
  /\|\s*curl\s+/i,
  /\|\s*wget\s+/i,
  
  // Template injection
  /\{\{.*\}\}/,
  /\$\{.*\}/,
  /%\{.*\}/,
  
  // Excessive repetition (potential DoS)
  /(.)\1{50,}/,
  
  // Suspicious Unicode characters
  /[\u202E\u2066-\u2069]/,
];

// Malicious file patterns
const MALICIOUS_FILE_PATTERNS = [
  /\.(exe|bat|cmd|com|pif|scr|vbs|js|jar|app|deb|pkg|dmg)$/i,
  /\.(php|asp|aspx|jsp|py|rb|pl|sh|bash)$/i,
];

// Content sanitization functions
export function sanitizeQuery(input: string): string {
  if (!input) return '';
  
  // Basic sanitization
  let sanitized = input.trim();
  
  // Remove potential HTML/XML tags
  sanitized = DOMPurify.sanitize(sanitized, { 
    ALLOWED_TAGS: [], 
    ALLOWED_ATTR: [] 
  });
  
  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Remove null bytes and control characters
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Limit specific characters that could be problematic
  sanitized = sanitized.replace(/[<>{}]/g, '');
  
  return sanitized;
}

export function detectPromptInjection(input: string): {
  isDetected: boolean;
  patterns: string[];
  confidence: number;
} {
  const detectedPatterns: string[] = [];
  let totalMatches = 0;
  
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const matches = input.match(pattern);
    if (matches) {
      detectedPatterns.push(pattern.toString());
      totalMatches += matches.length;
    }
  }
  
  // Calculate confidence based on number of patterns and matches
  const confidence = Math.min(detectedPatterns.length * 0.3 + totalMatches * 0.1, 1.0);
  
  return {
    isDetected: detectedPatterns.length > 0,
    patterns: detectedPatterns,
    confidence,
  };
}

export function validateFileUpload(filename: string, mimeType: string, size: number): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check file size (10MB limit)
  if (size > 10 * 1024 * 1024) {
    errors.push('File size exceeds 10MB limit');
  }
  
  // Check for malicious file extensions
  for (const pattern of MALICIOUS_FILE_PATTERNS) {
    if (pattern.test(filename)) {
      errors.push('File type not allowed');
      break;
    }
  }
  
  // Validate MIME type
  const allowedMimeTypes = [
    'text/plain',
    'text/csv',
    'application/pdf',
    'application/json',
    'image/jpeg',
    'image/png',
    'image/gif',
  ];
  
  if (!allowedMimeTypes.includes(mimeType)) {
    errors.push('MIME type not allowed');
  }
  
  // Check for suspicious filename patterns
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    errors.push('Invalid filename format');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Request size limiting
export function validateRequestSize(req: Request, res: Response, next: NextFunction) {
  const maxSize = 1024 * 1024; // 1MB
  const contentLength = parseInt(req.headers['content-length'] || '0');
  
  if (contentLength > maxSize) {
    return res.status(413).json({
      error: 'Request payload too large',
      maxSize: `${maxSize / 1024 / 1024}MB`,
      code: 'PAYLOAD_TOO_LARGE',
    });
  }
  
  next();
}

// Generic validation middleware factory
export function validateRequest<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate and transform request data
      const validationResult = schema.safeParse({
        ...req.body,
        ...req.query,
        ...req.params,
      });
      
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));
        
        return res.status(400).json({
          error: 'Validation failed',
          details: errors,
          code: 'VALIDATION_ERROR',
        });
      }
      
      // Check for prompt injection in query fields
      if (validationResult.data.query) {
        const injectionCheck = detectPromptInjection(validationResult.data.query);
        
        if (injectionCheck.isDetected && injectionCheck.confidence > 0.5) {
          console.warn('Potential prompt injection detected:', {
            query: validationResult.data.query,
            patterns: injectionCheck.patterns,
            confidence: injectionCheck.confidence,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          });
          
          return res.status(400).json({
            error: 'Query contains potentially harmful content',
            code: 'POTENTIAL_INJECTION',
          });
        }
      }
      
      // Replace original request data with validated/sanitized data
      req.body = validationResult.data;
      req.query = validationResult.data;
      
      next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      return res.status(500).json({
        error: 'Internal validation error',
        code: 'VALIDATION_INTERNAL_ERROR',
      });
    }
  };
}

// Content-Type validation
export function validateContentType(allowedTypes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'];
    
    if (!contentType) {
      return res.status(400).json({
        error: 'Content-Type header required',
        code: 'MISSING_CONTENT_TYPE',
      });
    }
    
    const baseType = contentType.split(';')[0].trim();
    
    if (!allowedTypes.includes(baseType)) {
      return res.status(415).json({
        error: `Unsupported Content-Type. Allowed: ${allowedTypes.join(', ')}`,
        code: 'UNSUPPORTED_CONTENT_TYPE',
      });
    }
    
    next();
  };
}

// IP validation and geoblocking
export function validateClientIP(req: Request, res: Response, next: NextFunction) {
  const clientIP = req.ip || req.connection.remoteAddress || '';
  const blockedCountries = process.env.BLOCKED_COUNTRIES?.split(',') || [];
  const blockedIPs = process.env.BLOCKED_IPS?.split(',') || [];
  
  // Check if IP is explicitly blocked
  if (blockedIPs.includes(clientIP)) {
    return res.status(403).json({
      error: 'IP address blocked',
      code: 'IP_BLOCKED',
    });
  }
  
  // Basic validation for private/localhost IPs in production
  if (process.env.NODE_ENV === 'production') {
    if (validator.isPrivateIP(clientIP) && !process.env.ALLOW_PRIVATE_IPS) {
      return res.status(403).json({
        error: 'Private IP addresses not allowed',
        code: 'PRIVATE_IP_BLOCKED',
      });
    }
  }
  
  next();
}

// User-Agent validation
export function validateUserAgent(req: Request, res: Response, next: NextFunction) {
  const userAgent = req.headers['user-agent'];
  
  if (!userAgent) {
    return res.status(400).json({
      error: 'User-Agent header required',
      code: 'MISSING_USER_AGENT',
    });
  }
  
  // Check for suspicious User-Agent patterns
  const suspiciousPatterns = [
    /curl/i,
    /wget/i,
    /python-requests/i,
    /bot/i,
    /crawler/i,
    /spider/i,
  ];
  
  if (process.env.BLOCK_AUTOMATED_CLIENTS === 'true') {
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(userAgent)) {
        return res.status(403).json({
          error: 'Automated clients not allowed',
          code: 'AUTOMATED_CLIENT_BLOCKED',
        });
      }
    }
  }
  
  next();
}

// Specific validators for common endpoints
export const validateResearchRequest = validateRequest(ResearchRequestSchema);
export const validateStreamRequest = validateRequest(StreamRequestSchema);
export const validateApiKeyCreate = validateRequest(ApiKeyCreateSchema);
export const validateUserRegistration = validateRequest(UserRegistrationSchema);