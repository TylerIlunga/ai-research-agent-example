import { config } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = RANK[config.logLevel];

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  if (RANK[level] < threshold) return;

  if (config.isProduction) {
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...fields,
    });
    (level === "error" ? console.error : console.log)(line);
    return;
  }

  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  const stamp = new Date().toISOString().slice(11, 23);
  const target = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  target(`${stamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};
