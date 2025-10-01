import { strict as assert } from "node:assert";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { CalendarEvent } from "../../src/features/calendar";
import type { Category } from "../../src/bindings/Category";
import * as categoriesStore from "../../src/store/categories.ts";
import * as panelModule from "../../src/components/calendar/CalendarNotesPanel.tsx";

const baseEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: overrides.id ?? "evt-test",
  household_id: overrides.household_id ?? "hh-test",
  title: overrides.title ?? "Snapshot event",
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

const withDom = () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const previous = new Map<string, unknown>();

  const assign = (key: string, value: unknown) => {
    previous.set(key, (globalThis as Record<string, unknown>)[key]);
    if (value === undefined) {
      delete (globalThis as Record<string, unknown>)[key];
    } else {
      (globalThis as Record<string, unknown>)[key] = value;
    }
  };

  assign("window", dom.window as unknown as typeof globalThis.window);
  assign("document", dom.window.document);
  assign("HTMLElement", dom.window.HTMLElement);
  assign("CustomEvent", dom.window.CustomEvent);
  assign("Event", dom.window.Event);
  assign("Node", dom.window.Node);
  assign("navigator", dom.window.navigator);

  if (typeof dom.window.getComputedStyle === "function") {
    assign("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  }
  if (typeof dom.window.requestAnimationFrame === "function") {
    assign("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  }
  if (typeof dom.window.cancelAnimationFrame === "function") {
    assign("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  }

  return () => {
    dom.window.close();
    previous.forEach((value, key) => {
      if (value === undefined) {
        delete (globalThis as Record<string, unknown>)[key];
      } else {
        (globalThis as Record<string, unknown>)[key] = value;
      }
    });
  };
};

const withTauri = (
  handler: (cmd: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
) => {
  const win = globalThis.window as typeof globalThis.window | undefined;
  if (!win) throw new Error("window is not defined");
  const previous = (win as Record<string, unknown>).__TAURI_INTERNALS__;
  (win as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => handler(cmd, args),
    transformCallback: () => "cb",
    unregisterCallback: () => undefined,
  };
  return () => {
    if (previous === undefined) {
      delete (win as Record<string, unknown>).__TAURI_INTERNALS__;
    } else {
      (win as Record<string, unknown>).__TAURI_INTERNALS__ = previous;
    }
  };
};

const tick = async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

test.afterEach(() => {
  categoriesStore.__resetCategories();
});

test("ensureEventPersisted invokes event_create with anchor id", async () => {
  const cleanupDom = withDom();
  const invocations: Array<[string, Record<string, unknown> | undefined]> = [];
  const cleanupTauri = withTauri(async (cmd, args) => {
    invocations.push([cmd, args]);
    if (cmd === "event_create") {
      return null;
    }
    throw new Error(`Unexpected command ${cmd}`);
  });

  try {
    const event = baseEvent({
      tz: "America/New_York",
      id: "evt-series::2024-02-01T10:00:00Z",
      series_parent_id: "evt-series",
    });
    await panelModule.ensureEventPersisted(event, "hh-test");
    assert.equal(invocations.length, 1);
    const [command, payload] = invocations[0];
    assert.equal(command, "event_create");
    assert.deepEqual(payload?.data, {
      id: "evt-series",
      title: event.title,
      start_at_utc: event.start_at_utc,
      tz: event.tz,
      household_id: "hh-test",
    });
  } finally {
    cleanupTauri();
    cleanupDom();
  }
});

test("ensureEventPersisted swallows unique constraint errors", async () => {
  const cleanupDom = withDom();
  const cleanupTauri = withTauri(async (cmd) => {
    if (cmd === "event_create") {
      throw new Error("UNIQUE constraint failed: events.id");
    }
    return null;
  });

  try {
    await assert.doesNotReject(async () => {
      await panelModule.ensureEventPersisted(baseEvent(), "hh-test");
    });
  } finally {
    cleanupTauri();
    cleanupDom();
  }
});

test("CalendarNotesPanel persists events before loading and quick capture using anchor ids", async () => {
  const cleanupDom = withDom();
  const invocations: Array<[string, Record<string, unknown> | undefined]> = [];
  const noteTimestamp = Date.now();
  const cleanupTauri = withTauri(async (cmd, args) => {
    invocations.push([cmd, args]);
    switch (cmd) {
      case "event_create":
        return null;
      case "get_default_household_id":
        return "hh-test";
      case "note_links_list_by_entity":
        assert.equal(args.entityId, "evt-series");
        return { items: [] };
      case "notes_create":
        return {
          id: "note-test",
          household_id: args.household_id,
          category_id: args.data?.category_id,
          position: 0,
          created_at: noteTimestamp,
          updated_at: noteTimestamp,
          text: args.data?.text,
          color: args.data?.color ?? "#FFF4B8",
          x: 0,
          y: 0,
        };
      case "note_links_create":
        assert.equal(args.entityId, "evt-series");
        return {
          id: "link-test",
          household_id: args.household_id,
          note_id: args.note_id,
          entity_type: args.entity_type,
          entity_id: args.entity_id,
          relation: "primary",
          created_at: noteTimestamp,
          updated_at: noteTimestamp,
        };
      default:
        return null;
    }
  });

  try {
    categoriesStore.setCategories([
      {
        id: "cat-primary",
        name: "Primary",
        slug: "primary",
        color: "#4F46E5",
        household_id: "hh-test",
        position: 0,
        z: 0,
        is_visible: true,
        created_at: Date.now(),
        updated_at: Date.now(),
        deleted_at: null,
      } as Category,
    ]);

    const panel = panelModule.CalendarNotesPanel();
    document.body.appendChild(panel.element);

    const event = baseEvent({
      id: "evt-series::2024-02-01T10:00:00Z",
      series_parent_id: "evt-series",
    });
    panel.setEvent(event);

    await tick();
    await tick();

    const eventCreateCallsAfterSelect = invocations.filter(
      ([command]) => command === "event_create",
    ).length;
    assert.equal(eventCreateCallsAfterSelect, 1);

    const quickForm = panel.element.querySelector(".calendar-notes-panel__quick") as HTMLFormElement;
    const quickInput = panel.element.querySelector(".calendar-notes-panel__input") as HTMLInputElement;
    quickInput.value = "Prep notes";

    quickForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

    await tick();
    await tick();

    const eventCreateCallsAfterQuick = invocations.filter(([command]) => command === "event_create").length;
    assert.equal(eventCreateCallsAfterQuick, 2);

    const createCall = invocations.find(([command]) => command === "notes_create");
    assert.ok(createCall, "notes_create should be invoked");
    assert.equal(createCall?.[1]?.data?.text, "Prep notes");

    const linkCall = invocations.find(([command]) => command === "note_links_create");
    assert.ok(linkCall, "note_links_create should be invoked");
    assert.equal(linkCall?.[1]?.entityId, "evt-series");
  } finally {
    cleanupTauri();
    cleanupDom();
  }
});

test("CalendarNotesPanel renders linked notes for recurrence instances", async () => {
  const cleanupDom = withDom();
  const noteTimestamp = Date.now();
  const cleanupTauri = withTauri(async (cmd, args) => {
    switch (cmd) {
      case "event_create":
        return null;
      case "get_default_household_id":
        return "hh-test";
      case "note_links_list_by_entity":
        assert.equal(args.entityId, "evt-series");
        return {
          items: [
            {
              note: {
                id: "note-1",
                household_id: "hh-test",
                category_id: "cat-primary",
                position: 0,
                created_at: noteTimestamp,
                updated_at: noteTimestamp,
                text: "Series note",
                color: "#FFCC00",
                x: 0,
                y: 0,
              },
              link: {
                id: "link-1",
                household_id: "hh-test",
                note_id: "note-1",
                entity_type: "event",
                entity_id: "evt-series",
                relation: "primary",
                created_at: noteTimestamp,
                updated_at: noteTimestamp,
              },
            },
          ],
        };
      default:
        return null;
    }
  });

  try {
    const panel = panelModule.CalendarNotesPanel();
    document.body.appendChild(panel.element);

    const event = baseEvent({
      id: "evt-series::2024-02-02T15:00:00Z",
      series_parent_id: "evt-series",
    });

    panel.setEvent(event);

    await tick();
    await tick();

    const items = panel.element.querySelectorAll(".calendar-notes-panel__item");
    assert.equal(items.length, 1);
    const text = items[0]?.querySelector(".calendar-notes-panel__text");
    assert.equal(text?.textContent, "Series note");
  } finally {
    cleanupTauri();
    cleanupDom();
  }
});
