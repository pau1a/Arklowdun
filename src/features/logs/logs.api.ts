import { call } from "@lib/ipc/call";

export function getTail(): Promise<(string | Record<string, unknown>)[]> {
  return call<(string | Record<string, unknown>)[]>("diagnostics_summary");
}
