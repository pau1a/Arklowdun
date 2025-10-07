import { log } from '@utils/logger';

interface LogEventPayload {
  event: string;
  payload: Record<string, unknown>;
}

const GLOBAL_LOG_KEY = '__arklowdun_files_logs__';

async function sha256(value: string): Promise<string> {
  try {
    if (!('crypto' in window) || !window.crypto?.subtle) {
      return 'sha256-unavailable';
    }
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    log.warn('files_log_hash_error', error);
    return 'sha256-error';
  }
}

function pushGlobalLog(entry: LogEventPayload): void {
  const globalObject = window as typeof window & {
    [GLOBAL_LOG_KEY]?: LogEventPayload[];
  };
  if (!Array.isArray(globalObject[GLOBAL_LOG_KEY])) {
    globalObject[GLOBAL_LOG_KEY] = [];
  }
  globalObject[GLOBAL_LOG_KEY]!.push(entry);
}

async function emit(event: string, payload: Record<string, unknown>): Promise<void> {
  const entry: LogEventPayload = { event, payload };
  pushGlobalLog(entry);
  log.info(event, payload);
}

export async function logScanStarted(path: string): Promise<void> {
  const pathHash = await sha256(path);
  await emit('files_list_scan_started', { path: pathHash, ts: Date.now() });
}

export async function logScanCompleted(options: {
  path: string;
  scanTimeMs: number | null;
  entryCount: number;
  virtualized: boolean;
}): Promise<void> {
  const pathHash = await sha256(options.path);
  await emit('files_list_scan_completed', {
    path: pathHash,
    scan_time_ms: options.scanTimeMs ?? null,
    entry_count: options.entryCount,
    virtualized: options.virtualized ? 'yes' : 'no',
    ts: Date.now(),
  });
}

export async function logScanAborted(path: string, reason: 'timeout' | 'navigation'): Promise<void> {
  const pathHash = await sha256(path);
  await emit('files_list_scan_aborted', {
    path: pathHash,
    reason,
    ts: Date.now(),
  });
}

export async function logPreviewBlocked(options: {
  path: string;
  reason: string;
}): Promise<void> {
  const pathHash = await sha256(options.path);
  await emit('files_preview_blocked', {
    path: pathHash,
    reason: options.reason,
    ts: Date.now(),
  });
}
