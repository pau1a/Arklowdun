import { call } from "@lib/ipc/call";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

import type { DbRepairSummary } from "@bindings/DbRepairSummary";
import type { DbRepairEvent } from "@bindings/DbRepairEvent";

export function runRepair(): Promise<DbRepairSummary> {
  return call<DbRepairSummary>("db_repair_run");
}

export function listenRepairEvents(
  handler: (event: DbRepairEvent) => void,
): Promise<UnlistenFn> {
  const callback: EventCallback<DbRepairEvent> = (event) => {
    handler(event.payload);
  };
  return listen<DbRepairEvent>("db_repair_progress", callback);
}
