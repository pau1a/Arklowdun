import test from "node:test";
import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import {
  actions,
  selectors,
  subscribe,
  __resetStore,
} from "../src/store/index.ts";
import { emit, on, __resetListeners } from "../src/store/events.ts";

test.beforeEach(() => {
  __resetStore();
  __resetListeners();
});

test("files snapshot updates consumers and emits event", () => {
  const dom = new JSDOM("<div id='host'></div>");
  const host = dom.window.document.getElementById("host");
  if (!host) throw new Error("missing host");

  const unsubscribe = subscribe(selectors.files.items, (items) => {
    host.textContent = String(items.length);
  });
  assert.equal(host.textContent, "0");

  const received: Array<{ count: number; ts: number }> = [];
  const off = on("files:updated", (payload) => {
    received.push({ count: payload.count, ts: payload.ts });
  });

  const payload = actions.files.updateSnapshot({
    items: [
      {
        name: "example.txt",
        isDirectory: false,
      } as any,
    ],
    ts: 42,
    path: ".",
    source: "test",
  });
  emit("files:updated", payload);

  assert.equal(host.textContent, "1");
  assert.equal(received.length, 1);
  assert.equal(received[0].count, 1);
  assert.equal(received[0].ts, 42);

  unsubscribe();
  off();
});
