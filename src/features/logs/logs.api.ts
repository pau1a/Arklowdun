import { call } from "@lib/ipc/call";

export function getTail(): Promise<unknown> {
  return call<unknown>("diagnostics_summary");
}
