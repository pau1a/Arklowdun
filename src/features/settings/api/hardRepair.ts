import { call } from "@lib/ipc/call";

import type { HardRepairOutcome } from "@bindings/HardRepairOutcome";

export function runHardRepair(): Promise<HardRepairOutcome> {
  return call<HardRepairOutcome>("db_hard_repair_run");
}
