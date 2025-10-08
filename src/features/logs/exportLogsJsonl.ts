import type { SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import type { LogEntry, LogLevel } from "./logs.types";

const LOG_EXPORT_SCHEMA_VERSION = 26;
const JSONL_FILTER = { name: "JSON Lines", extensions: ["jsonl"] } as const;

interface ExportDependencies {
  saveDialog: (options: SaveDialogOptions) => Promise<string | null>;
  writeTextFile: (path: string, contents: string) => Promise<void>;
  getDesktopDir: () => Promise<string | null>;
  joinPath: (...paths: string[]) => Promise<string>;
  getAppVersion: () => Promise<string>;
  getSchemaVersion: () => Promise<number>;
  getOsDescription: () => Promise<string>;
  now: () => Date;
}

export interface ExportLogsJsonlOptions {
  entries: LogEntry[];
  filters: {
    severity: LogLevel;
    categories: string[];
  };
  deps?: Partial<ExportDependencies>;
}

export interface ExportLogsJsonlResult {
  filePath: string;
  fileName: string;
  checksum: string;
  recordCount: number;
  exportedAtUtc: string;
}

let defaultDepsPromise: Promise<ExportDependencies> | null = null;

const envRecord =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function fallbackAppVersion(): string {
  return (
    envRecord.VITE_APP_VERSION ??
    envRecord.APP_VERSION ??
    envRecord.npm_package_version ??
    "unknown"
  );
}

function normalizePlatform(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase();
  switch (key) {
    case "macos":
      return "macOS";
    case "ios":
      return "iOS";
    case "windows":
      return "Windows";
    case "linux":
      return "Linux";
    case "android":
      return "Android";
    default:
      return value;
  }
}

function normalizeArch(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toLowerCase();
  switch (key) {
    case "aarch64":
      return "arm64";
    case "x86_64":
      return "x86_64";
    case "i686":
      return "x86";
    default:
      return value;
  }
}

function deriveOsFromNavigator(): string {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const ua = navigator.userAgent ?? "";
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string; architecture?: string };
  }).userAgentData;

  const rawPlatform = uaData?.platform ?? navigator.platform ?? "";
  let platformLabel = normalizePlatform(rawPlatform) ?? rawPlatform;
  let versionLabel = "";

  const macMatch = ua.match(/Mac OS X ([0-9_]+)/);
  const windowsMatch = ua.match(/Windows NT ([0-9.]+)/);
  const androidMatch = ua.match(/Android ([0-9.]+)/);
  const iosMatch = ua.match(/(?:iPhone|CPU) OS ([0-9_]+)/);

  if (macMatch) {
    platformLabel = "macOS";
    versionLabel = macMatch[1]?.replace(/_/g, ".") ?? "";
  } else if (windowsMatch) {
    platformLabel = "Windows";
    versionLabel = windowsMatch[1] ?? "";
  } else if (androidMatch) {
    platformLabel = "Android";
    versionLabel = androidMatch[1] ?? "";
  } else if (iosMatch) {
    platformLabel = "iOS";
    versionLabel = iosMatch[1]?.replace(/_/g, ".") ?? "";
  } else if (/Linux/i.test(ua)) {
    platformLabel = "Linux";
  }

  let arch = uaData?.architecture ?? "";
  if (!arch) {
    if (/arm64|aarch64/i.test(ua) || /arm/i.test(rawPlatform)) {
      arch = "arm64";
    } else if (/Win64|x64|WOW64|x86_64/i.test(ua) || /x64|Intel|Win64/i.test(rawPlatform)) {
      arch = "x86_64";
    }
  }

  const archLabel = normalizeArch(arch) ?? arch;
  const parts = [platformLabel?.trim(), versionLabel.trim(), archLabel?.trim()]
    .filter((part) => part)
    .join(" ");
  return parts || "unknown";
}

function fallbackOsDescription(): string {
  const derived = deriveOsFromNavigator();
  if (derived !== "unknown") {
    return derived;
  }
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string; architecture?: string };
  }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";
  const arch = uaData?.architecture ?? "";
  const fallbackParts = [platform.trim(), arch.trim()].filter((part) => part);
  if (fallbackParts.length > 0) {
    return fallbackParts.join(" ");
  }
  return navigator.userAgent || "unknown";
}

async function loadDefaultDeps(): Promise<ExportDependencies> {
  const dialogModPromise = import("@tauri-apps/plugin-dialog");
  const fsModPromise = import("@tauri-apps/plugin-fs");
  const pathModPromise = import("@tauri-apps/api/path");

  const [dialogMod, fsMod, pathMod] = await Promise.all([
    dialogModPromise,
    fsModPromise,
    pathModPromise,
  ]);

  async function resolveAppVersion(): Promise<string> {
    try {
      const appMod = await import("@tauri-apps/api/app");
      return await appMod.getVersion();
    } catch {
      return fallbackAppVersion();
    }
  }

  async function resolveOsDescription(): Promise<string> {
    return fallbackOsDescription();
  }

  async function resolveDesktopDir(): Promise<string | null> {
    try {
      const dir = await pathMod.desktopDir();
      if (!dir) return null;
      return dir;
    } catch {
      return null;
    }
  }

  return {
    saveDialog: (options) => dialogMod.save(options),
    writeTextFile: (path, contents) => fsMod.writeTextFile(path, contents),
    getDesktopDir: resolveDesktopDir,
    joinPath: (...paths: string[]) => pathMod.join(...paths),
    getAppVersion: resolveAppVersion,
    getSchemaVersion: async () => LOG_EXPORT_SCHEMA_VERSION,
    getOsDescription: resolveOsDescription,
    now: () => new Date(),
  };
}

async function getDependencies(overrides?: Partial<ExportDependencies>): Promise<ExportDependencies> {
  if (!defaultDepsPromise) {
    defaultDepsPromise = loadDefaultDeps();
  }
  const base = await defaultDepsPromise;
  return { ...base, ...(overrides ?? {}) };
}

function ensureCrypto(): Crypto {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API is not available");
}

async function computeSha256(payload: string): Promise<string> {
  const cryptoObj = ensureCrypto();
  const encoder = new TextEncoder();
  const hashBuffer = await cryptoObj.subtle.digest("SHA-256", encoder.encode(payload));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function formatFilenameTimestamp(date: Date): string {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split("T");
  if (!timePart) return iso.replace(/[:]/g, "-").replace(/\..+/, "");
  const [timeWithoutMs] = timePart.split(".");
  if (!timeWithoutMs) {
    return `${datePart}T00-00Z`;
  }
  const [hours = "00", minutes = "00"] = timeWithoutMs.split(":");
  return `${datePart}T${hours}-${minutes}Z`;
}

function buildFilename(
  appVersion: string,
  exportedAt: Date,
  severity: LogLevel,
  categories: string[],
): string {
  const appSegment = sanitizeSegment(appVersion, "unknown");
  const severitySegment = sanitizeSegment(severity, "info");
  const categoriesSegment =
    categories.length > 0
      ? categories
          .map((category) => sanitizeSegment(category, "misc"))
          .filter((segment) => segment.length > 0)
          .join(",") || "all"
      : "all";
  const timestampSegment = formatFilenameTimestamp(exportedAt);
  return `arklowdun-tail_${appSegment}_${timestampSegment}_sev-${severitySegment}_cats-${categoriesSegment}.jsonl`;
}

function getRawPayload(entry: LogEntry): Record<string, unknown> {
  if (entry.raw && typeof entry.raw === "object" && !Array.isArray(entry.raw)) {
    return entry.raw;
  }
  return { ...entry };
}

function uniqueSortedCategories(categories: string[]): string[] {
  const unique = Array.from(new Set(categories));
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

export async function exportLogsJsonl(
  options: ExportLogsJsonlOptions,
): Promise<ExportLogsJsonlResult | null> {
  const { entries, filters, deps: overrides } = options;
  if (!Array.isArray(entries)) {
    throw new Error("entries must be an array");
  }

  const dependencies = await getDependencies(overrides);

  const trimmed = entries.slice(-200);
  const recordCount = trimmed.length;
  const exportedAt = dependencies.now();
  const exportedAtUtc = exportedAt.toISOString();
  const appVersion = await dependencies.getAppVersion();
  const schemaVersion = await dependencies.getSchemaVersion();
  const osDescription = await dependencies.getOsDescription();
  const categories = uniqueSortedCategories(filters.categories);
  const fileName = buildFilename(appVersion, exportedAt, filters.severity, categories);

  const metaLine = JSON.stringify({
    _meta: {
      app_version: appVersion,
      schema_version: schemaVersion,
      os: osDescription,
      exported_at_utc: exportedAtUtc,
      filters: {
        severity: `>=${filters.severity}`,
        categories,
      },
      record_count: recordCount,
    },
  });

  const payloadLines = trimmed.map((entry) => JSON.stringify(getRawPayload(entry)));
  const payloadText = payloadLines.join("\n");
  const checksum = await computeSha256(payloadText);
  const checksumLine = JSON.stringify({
    _checksum: {
      sha256: checksum,
      record_count: recordCount,
    },
  });

  const segments = [metaLine];
  if (payloadLines.length > 0) {
    segments.push(...payloadLines);
  }
  segments.push(checksumLine);
  const fileContents = `${segments.join("\n")}\n`;

  let defaultPath: string | undefined;
  try {
    const desktop = await dependencies.getDesktopDir();
    if (desktop) {
      defaultPath = await dependencies.joinPath(desktop, fileName);
    }
  } catch {
    defaultPath = undefined;
  }

  const savePath = await dependencies.saveDialog({
    defaultPath,
    filters: [JSONL_FILTER],
  });

  if (!savePath) {
    return null;
  }

  await dependencies.writeTextFile(savePath, fileContents);

  return {
    filePath: savePath,
    fileName,
    checksum,
    recordCount,
    exportedAtUtc,
  };
}
