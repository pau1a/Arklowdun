import { normalizeError } from "@lib/ipc/call";
import { logUI } from "@lib/uiLog";
import { updateDiagnosticsSection, getDiagnosticsSection } from "../../diagnostics/runtime";
import type { AppError } from "@bindings/AppError";

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FAILURE_EVENTS = 200;

function now(): number {
  return Date.now();
}

async function pruneFailures(existing: unknown): Promise<string[]> {
  if (!Array.isArray(existing)) {
    return [];
  }
  const cutoff = now() - FAILURE_WINDOW_MS;
  return existing
    .map((entry) => {
      const timestamp = typeof entry === "string" ? Date.parse(entry) : Number(entry);
      if (!Number.isFinite(timestamp)) return null;
      return new Date(timestamp).toISOString();
    })
    .filter((iso): iso is string => {
      const ts = Date.parse(iso);
      return Number.isFinite(ts) && ts >= cutoff;
    });
}

export async function recordPetsMutationFailure(
  op: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<AppError> {
  const normalized = normalizeError(error);
  const details: Record<string, unknown> = {
    op,
    code: normalized.code,
    crash_id: normalized.crash_id ?? null,
    ...context,
  };
  logUI("ERROR", "ui.pets.mutation_fail", details);

  try {
    const section = await getDiagnosticsSection("pets");
    const existing = await pruneFailures(section?.failure_events);
    const nextEvents = [...existing, new Date(now()).toISOString()];
    const bounded = nextEvents.slice(Math.max(0, nextEvents.length - MAX_FAILURE_EVENTS));
    updateDiagnosticsSection("pets", {
      failure_events: bounded,
      last_24h_failures: bounded.length,
    });
  } catch (diagError) {
    console.warn("pets mutation diagnostics update failed", diagError);
  }

  return normalized;
}
