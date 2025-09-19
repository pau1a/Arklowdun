import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";

export type BackfillProgressEvent = {
  type: "progress";
  household_id: string;
  scanned: number;
  updated: number;
  skipped: number;
  remaining: number;
  elapsed_ms: number;
  chunk_size: number;
};

export type BackfillSummaryEvent = {
  type: "summary";
  household_id?: string;
  scanned?: number;
  updated?: number;
  skipped?: number;
  elapsed_ms?: number;
  status: "completed" | "cancelled" | "failed";
  error?: {
    code: string;
    message: string;
  };
};

export type BackfillEvent = BackfillProgressEvent | BackfillSummaryEvent;

export function listenBackfillEvents(
  handler: (event: BackfillEvent) => void,
): Promise<UnlistenFn> {
  const callback: EventCallback<BackfillEvent> = (event) => {
    handler(event.payload);
  };
  return listen<BackfillEvent>("events_tz_backfill_progress", callback);
}
