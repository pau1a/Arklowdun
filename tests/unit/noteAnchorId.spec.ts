import { strict as assert } from "node:assert";
import test from "node:test";

import { noteAnchorId } from "../../src/utils/noteAnchorId";
import type { CalendarEvent } from "../../src/features/calendar";

const baseEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: overrides.id ?? "evt-1",
  household_id: overrides.household_id ?? "hh-1",
  title: overrides.title ?? "Sample",
  start_at_utc: overrides.start_at_utc ?? Date.now(),
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
  tz: overrides.tz,
  end_at_utc: overrides.end_at_utc,
  rrule: overrides.rrule,
  exdates: overrides.exdates,
  reminder: overrides.reminder,
  deleted_at: overrides.deleted_at,
  series_parent_id: overrides.series_parent_id,
});

test("noteAnchorId prefers series_parent_id when available", () => {
  const event = baseEvent({ id: "evt-1::123", series_parent_id: "evt-series" });
  assert.equal(noteAnchorId(event), "evt-series");
});

test("noteAnchorId falls back to event id when parent is missing", () => {
  const event = baseEvent({ id: "evt-2::456", series_parent_id: undefined });
  assert.equal(noteAnchorId(event), "evt-2::456");
});
