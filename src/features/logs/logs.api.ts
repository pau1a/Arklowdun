import { call } from "@lib/ipc/call";

export function getTail({ signal }: { signal?: AbortSignal } = {}): Promise<unknown> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return call<unknown>("diagnostics_summary");
}
