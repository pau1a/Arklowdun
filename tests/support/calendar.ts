import type { Page } from '@playwright/test';
import type { Event as CalendarEvent } from '/src/bindings/Event';

import { STORE_MODULE_PATH } from './store';

export interface CalendarEventFactoryOptions {
  baseTs: number;
  count: number;
  idSeed: string;
  householdId?: string;
  titlePrefix?: string;
  appendIndex?: boolean;
  stepMs?: number;
  durationMs?: number | null;
  tz?: string;
}

export function createUtcEvents({
  baseTs,
  count,
  idSeed,
  householdId = 'playwright-household',
  titlePrefix = 'Event',
  appendIndex = true,
  stepMs = 60_000,
  durationMs = 30_000,
  tz,
}: CalendarEventFactoryOptions): CalendarEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const start = baseTs + index * stepMs;
    const title = appendIndex && count > 1 ? `${titlePrefix} ${index + 1}` : titlePrefix;

    const event: CalendarEvent = {
      id: `${idSeed}-${index + 1}`,
      household_id: householdId,
      title,
      start_at_utc: start,
      created_at: baseTs,
      updated_at: baseTs,
    };

    if (durationMs != null) {
      event.end_at_utc = start + durationMs;
    }

    if (tz) {
      event.tz = tz;
    }

    return event;
  });
}

export interface SeedCalendarSnapshotOptions {
  events: CalendarEvent[];
  truncated: boolean;
  ts: number;
  window: { start: number; end: number };
  source?: string;
  limit?: number;
}

export async function seedCalendarSnapshot(
  page: Page,
  { events, truncated, ts, window, source, limit }: SeedCalendarSnapshotOptions,
): Promise<void> {
  const snapshot = {
    items: events,
    ts,
    window,
    truncated,
    ...(limit !== undefined ? { limit } : {}),
    ...(source !== undefined ? { source } : {}),
  };

  await page.evaluate(
    async ({ storeModulePath, payload }) => {
      const { actions } = await import(storeModulePath);
      actions.events.updateSnapshot(payload);
    },
    { storeModulePath: STORE_MODULE_PATH, payload: snapshot },
  );
}
