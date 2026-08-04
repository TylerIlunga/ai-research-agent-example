import type { Request, Response } from "express";
import {
  applyRuntimeKeys,
  config,
  configWarnings,
  RUNTIME_KEYS,
  type RuntimeKey,
} from "../config/env";
import { resetModelCache } from "../models";
import { resetMemory } from "../tools/memory";
import { logger } from "../utils/logger";

/**
 * Which credentials the server holds, without ever revealing them.
 *
 * The UI needs to know whether a slot is filled to render its settings panel;
 * it never needs the value, so only a boolean crosses the wire.
 */
function keyPresence(): Record<RuntimeKey, boolean> {
  return {
    ANTHROPIC_API_KEY: Boolean(config.anthropic.apiKey),
    OPENAI_API_KEY: Boolean(config.openai.apiKey),
    OPENAI_BASE_URL: Boolean(config.openai.baseUrl),
    TAVILY_API_KEY: Boolean(config.search.tavilyKey),
    BRAVE_API_KEY: Boolean(config.search.braveKey),
    SEARXNG_URL: Boolean(config.search.searxngUrl),
  };
}

export function describeConfig() {
  return {
    // Included here (not only on /healthz) because the client replaces its
    // whole health object with this payload after saving keys.
    status: config.capabilities.reasoning ? ("healthy" as const) : ("degraded" as const),
    provider: config.provider,
    model: config.activeModel,
    failover: config.isFailover,
    providerPinned: config.providerPinned,
    searchPinned: config.searchPinned,
    searchProvider: config.searchProvider,
    searchFailover: config.isSearchFailover,
    researchMode: config.researchMode,
    capabilities: config.capabilities,
    claudeCodeAvailable: config.claudeCode.available,
    allowRuntimeKeys: config.allowRuntimeKeys,
    keys: keyPresence(),
    warnings: configWarnings(),
  };
}

export const getConfig = (_req: Request, res: Response): void => {
  res.json(describeConfig());
};

/**
 * Accepts credentials at runtime so the app can be made useful without editing
 * `.env` and restarting.
 *
 * Deliberate limits:
 * - Off in production unless `ALLOW_RUNTIME_KEYS=true`. Anyone who can reach
 *   this endpoint could otherwise choose whose account the server spends from.
 * - Values are held in memory only. Nothing is written to disk, so a restart
 *   returns to whatever `.env` says — no surprise persistence of a secret.
 * - Only the names are logged. The values never appear in a log line or a
 *   response body.
 */
export const updateConfig = (req: Request, res: Response): void => {
  if (!config.allowRuntimeKeys) {
    res.status(403).json({
      error:
        "Runtime key entry is disabled on this server. Set the keys in the environment instead.",
      code: "RUNTIME_KEYS_DISABLED",
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<Record<RuntimeKey, string | null>> = {};

  for (const key of RUNTIME_KEYS) {
    if (!(key in body)) continue;
    const value = body[key];

    if (value === null || value === "") {
      updates[key] = null;
      continue;
    }
    if (typeof value !== "string") {
      res.status(400).json({ error: `${key} must be a string or null.`, code: "INVALID_VALUE" });
      return;
    }
    if (value.length > 500) {
      res.status(400).json({ error: `${key} is implausibly long.`, code: "INVALID_VALUE" });
      return;
    }
    if (key.endsWith("_URL") && !/^https?:\/\//i.test(value.trim())) {
      res.status(400).json({ error: `${key} must be an http(s) URL.`, code: "INVALID_VALUE" });
      return;
    }
    updates[key] = value;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No recognized keys were supplied.", code: "NOTHING_TO_DO" });
    return;
  }

  const changed = applyRuntimeKeys(updates);
  // Providers and the vector store are memoized per credential set; drop both
  // so the next request builds against what was just supplied.
  resetModelCache();
  resetMemory();

  logger.info("Runtime credentials updated", {
    changed,
    provider: config.provider,
    searchProvider: config.searchProvider,
  });

  res.json({ changed, ...describeConfig() });
};
