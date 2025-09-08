type Level = "debug" | "info" | "warn" | "error";

const ORDER: Level[] = ["debug", "info", "warn", "error"];
const configured = (import.meta.env.VITE_LOG_LEVEL as Level) || "info";

function shouldLog(level: Level) {
  return ORDER.indexOf(level) >= ORDER.indexOf(configured);
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("debug")) console.debug(...args);
  },
  info: (...args: unknown[]) => {
    if (shouldLog("info")) console.info(...args);
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("warn")) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    if (shouldLog("error")) console.error(...args);
  },
};
