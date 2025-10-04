import type { DbHealthReport } from "@bindings/DbHealthReport";
import type { AppError } from "@bindings/AppError";
import { actions } from "@store/index";
import { recoveryText } from "@strings/recovery";
import { getIpcAdapter } from "./provider";
import type { ContractRequest, ContractResponse, IpcCommand } from "./port";

const FALLBACK_CODE = "APP/UNKNOWN";
export const DB_UNHEALTHY_WRITE_BLOCKED = "DB_UNHEALTHY_WRITE_BLOCKED";
export const DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE = recoveryText(
  "db.unhealthy_banner.subtitle",
);

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord =>
  typeof v === "object" && v !== null;

const normalizeContext = (
  value: unknown,
): Record<string, string> | undefined => {
  if (!isRecord(value)) return undefined;
  const pairs = Object.entries(value).map(([k, v]) => [k, String(v)]);
  return pairs.length ? Object.fromEntries(pairs) : undefined;
};

export function normalizeError(error: unknown): AppError {
  if (typeof error === "string") {
    return { code: FALLBACK_CODE, message: error, context: undefined };
  }

  if (isRecord(error)) {
    const code =
      typeof error.code === "string" ? error.code : FALLBACK_CODE;
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof error.name === "string"
          ? error.name
          : JSON.stringify(error);

    const ctx = normalizeContext(error.context);

    const record = error as UnknownRecord;
    let crashId: string | undefined;
    if (typeof record.crash_id === "string") {
      crashId = record.crash_id;
    } else if (typeof record.crashId === "string") {
      crashId = record.crashId;
    }

    const out: AppError = { code, message, context: ctx, crash_id: crashId };

    if (code === DB_UNHEALTHY_WRITE_BLOCKED) {
      out.message = DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE;
    }

    const healthReport = record.health_report ?? record.healthReport;
    if (healthReport && typeof healthReport === "object") {
      out.health_report = healthReport as DbHealthReport;
    }

    if (error.cause) out.cause = normalizeError(error.cause);
    else if (typeof error.stack === "string" && !out.context?.stack) {
      out.context = { ...(out.context ?? {}), stack: error.stack };
    }

    return out;
  }

  return { code: FALLBACK_CODE, message: String(error), context: undefined };
}

const DB_HEALTH_COMMANDS = new Set<IpcCommand>([
  "db_get_health_report",
  "db_recheck",
]);

export async function call<K extends IpcCommand>(
  cmd: K,
  args?: ContractRequest<K>,
): Promise<ContractResponse<K>>;
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
export async function call(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const adapter = getIpcAdapter();
  const typedCmd = cmd as IpcCommand;
  const payload = (args ?? {}) as ContractRequest<typeof typedCmd>;
  const trackDbHealth = DB_HEALTH_COMMANDS.has(typedCmd);
  if (trackDbHealth) {
    actions.db.health.beginCheck();
  }
  try {
    const result = await adapter.invoke(typedCmd, payload);
    if (trackDbHealth) {
      actions.db.health.receive(result as unknown as DbHealthReport);
    }
    return result;
  } catch (err) {
    const normalized = normalizeError(err);
    if (normalized.health_report) {
      actions.db.health.receive(normalized.health_report);
    }
    if (trackDbHealth) {
      actions.db.health.fail(normalized);
    }
    throw normalized;
  }
}
