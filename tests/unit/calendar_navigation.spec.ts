import { strict as assert } from "node:assert";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";

import type { CalendarEvent, CalendarWindowRange } from "../../src/features/calendar";

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
    assign(
      "requestAnimationFrame",
      dom.window.requestAnimationFrame.bind(dom.window),
    );
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

const tick = async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

interface SetupOptions {
  focusDate?: Date;
  events?: CalendarEvent[];
}

async function setupCalendarView(t: TestContext, options: SetupOptions = {}) {
  const cleanupDom = withDom();
  const { __resetStore } = await import("../../src/store/index.ts");
  __resetStore();
  const categoriesStore = await import("../../src/store/categories.ts");
  categoriesStore.__resetCategories();
  const eventBus = await import("../../src/store/events.ts");
  eventBus.__resetListeners();

  const calendarModule = await import("../../src/features/calendar/index.ts");
  const windows: CalendarWindowRange[] = [];
  const calendarLoader = async ({ window }: { window?: CalendarWindowRange } = {}) => {
    const currentFocus = options.focusDate ?? new Date();
    const resolvedWindow =
      window ?? calendarModule.calendarWindowAround(currentFocus.getTime());
    windows.push(resolvedWindow);
    return {
      data: {
        items: options.events ?? [],
        window: resolvedWindow,
        truncated: false,
        limit: 50,
      },
      error: null,
      isLoading: false,
    };
  };

  const { CalendarView } = await import("../../src/CalendarView.ts");
  const container = document.createElement("div");
  document.body.append(container);
  const focusDate = options.focusDate ?? new Date("2025-09-01T00:00:00Z");
  await CalendarView(container, {
    initialFocusDate: focusDate,
    calendarLoader,
    preloadCategories: async () => {},
    scheduleNotifications: () => {},
    createNotesPanel: () => ({
      element: document.createElement("aside"),
      setEvent() {},
      destroy() {},
    }),
  });
  await tick();

  return {
    container,
    windows,
    cleanup: () => {
      container.remove();
      cleanupDom();
    },
  };
}

test("CalendarView renders month navigation buttons", async (t) => {
  const { container, cleanup } = await setupCalendarView(t);
  try {
    const buttons = container.querySelectorAll(".calendar__nav-button");
    assert.equal(buttons.length, 2);
  } finally {
    cleanup();
  }
});

test("CalendarView navigation buttons advance and rewind the month", async (t) => {
  const focusDate = new Date("2025-09-01T00:00:00Z");
  const { container, windows, cleanup } = await setupCalendarView(t, { focusDate });
  try {
    const heading = container.querySelector(".calendar__month-label");
    assert.equal(heading?.textContent, "September 2025");

    const nextButton = container.querySelector(
      'button[aria-label="Next month"]',
    ) as HTMLButtonElement | null;
    assert.ok(nextButton, "next month button present");
    nextButton?.click();
    await tick();
    assert.equal(heading?.textContent, "October 2025");

    const prevButton = container.querySelector(
      'button[aria-label="Previous month"]',
    ) as HTMLButtonElement | null;
    assert.ok(prevButton, "previous month button present");
    prevButton?.click();
    await tick();
    assert.equal(heading?.textContent, "September 2025");

    assert.ok(
      windows.length >= 3,
      "initial load and two navigation clicks trigger calendar fetches",
    );
  } finally {
    cleanup();
  }
});

test("CalendarView navigation row snapshot contains chevrons and month", async (t) => {
  const focusDate = new Date("2025-09-01T00:00:00Z");
  const { container, cleanup } = await setupCalendarView(t, { focusDate });
  try {
    const nav = container.querySelector(".calendar__nav");
    assert.ok(nav, "calendar navigation row rendered");
    const children = Array.from(nav?.children ?? []);
    assert.equal(children.length, 3);
    const [prev, label, next] = children;
    assert.equal(prev?.textContent, "‹");
    assert.equal(label?.textContent, "September 2025");
    assert.equal(next?.textContent, "›");
  } finally {
    cleanup();
  }
});
