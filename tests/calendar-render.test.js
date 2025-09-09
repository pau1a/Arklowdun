import test from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

const sampleEvents = [
  {
    id: "e1",
    household_id: "HH",
    title: "t",
    start_at: 0,
    end_at: 0,
    start_at_utc: 0,
    end_at_utc: 0,
    created_at: 0,
    updated_at: 0,
  },
];

test("Calendar renders without series_parent_id", async () => {
  globalThis.__TAURI__ = {
    core: { invoke: async () => sampleEvents },
    notification: {
      isPermissionGranted: async () => false,
      requestPermission: async () => "denied",
      sendNotification: () => {},
    },
  };
  const dom = new JSDOM("<div id=app></div>", { url: "http://localhost" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const { CalendarView } = await import("../src/CalendarView.ts");
  const container = document.getElementById("app");
  await CalendarView(container);
  assert.ok(container.querySelector(".calendar__month-label"));
});
