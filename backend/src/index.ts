import express from "express";
import helmet from "helmet";
import compression from "compression";
import { agentRouter } from "./routes/agent";
import { applySecurity, SecurityMonitor } from "./middleware/security";
import { globalRateLimit, ddosProtection } from "./middleware/rateLimiter";
import { validateRequestSize, validateClientIP, validateUserAgent } from "./middleware/validation";
// Loading config validates the environment, resolves capabilities, and (in
// development) mints ephemeral secrets. Import it before anything that reads
// process.env.
import { config, configWarnings } from "./config/env";
import { describeConfig } from "./controllers/configController";
import { logger } from "./utils/logger";

// Initialize express app
const app = express();
const port = config.port;

// Trust proxy (for rate limiting and IP detection behind load balancers)
app.set('trust proxy', process.env.TRUST_PROXY_HOPS || 1);

// Global security middleware (applied in order)
app.use(...applySecurity()); // CORS, security headers, HTTPS enforcement, threat intelligence
app.use(helmet()); // Additional security headers

// Response compression — but never for server-sent events. gzip buffers the
// stream, so progress events arrive in bursts (or all at once at the end),
// which silently defeats the entire streaming design.
app.use(
  compression({
    filter: (req, res) => {
      const contentType = String(res.getHeader("Content-Type") ?? "");
      if (contentType.includes("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  })
);

// DDoS and global rate limiting
app.use(ddosProtection);
app.use(globalRateLimit);

// Request validation
app.use(validateRequestSize);
app.use(validateClientIP);
app.use(validateUserAgent);

// Body parsing (after security measures)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Health check endpoint (no authentication required).
// Reports the resolved capability set so the UI can tell the truth about what
// the agent can currently do rather than discovering it mid-run.
app.get("/healthz", (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "unknown",
    environment: config.env,
    ...describeConfig(),
  });
});

// Security status endpoint (for monitoring)
app.get("/security/status", (req, res) => {
  const stats = SecurityMonitor.getEventsSummary(24);
  res.json({
    securityEvents: stats,
    timestamp: new Date().toISOString(),
  });
});

// API routes with authentication and rate limiting
app.use("/api/agent", agentRouter);

// 404 handler
app.use((req, res) => {
  SecurityMonitor.logEvent('404_not_found', {
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  }, 'low');
  
  res.status(404).json({
    error: "Endpoint not found",
    code: "NOT_FOUND",
    path: req.path,
  });
});

// Global error handler
app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Global error handler:', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  SecurityMonitor.logEvent('application_error', {
    error: error.message,
    path: req.path,
    method: req.method,
    ip: req.ip,
  }, 'medium');

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    ...(isDevelopment && { details: error.message, stack: error.stack }),
  });
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    console.log('HTTP server closed');
    
    // Clean up resources
    SecurityMonitor.logEvent('server_shutdown', { signal }, 'low');
    
    process.exit(0);
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    console.error('Forcing server shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Start server
const server = app.listen(port, () => {
  const { reasoning, webSearch, memory } = config.capabilities;
  const mark = (enabled: boolean) => (enabled ? "on " : "off");

  logger.info(`AI Research Agent API listening on http://localhost:${port}`, {
    environment: config.env,
    provider: config.provider,
    model: config.activeModel,
  });
  logger.info(
    `Capabilities — reasoning: ${mark(reasoning)} | web search: ${mark(webSearch)} | memory: ${mark(memory)}`
  );
  logger.info(
    `Search: ${config.searchProvider} | research mode: ${config.researchMode}`
  );

  for (const warning of configWarnings()) {
    logger.warn(warning);
  }

  SecurityMonitor.logEvent('server_start', {
    port,
    environment: config.env,
    timestamp: new Date().toISOString(),
  }, 'low');
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  SecurityMonitor.logEvent('uncaught_exception', {
    error: error.message,
    stack: error.stack,
  }, 'critical');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  SecurityMonitor.logEvent('unhandled_rejection', {
    reason: String(reason),
  }, 'high');
});

export default app;
