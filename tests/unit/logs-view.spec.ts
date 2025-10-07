import { strict as assert } from "node:assert";
import test from "node:test";
import { JSDOM } from "jsdom";

import { mountLogsView } from "../../src/ui/views/logsView";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const { document } = dom.window;

test("mountLogsView renders the logs scaffold", () => {
  const container = document.createElement("div");

  const cleanup = mountLogsView(container);

  const section = container.querySelector("section.logs-view");
  assert.ok(section, "logs view section should render");
  assert.equal(section?.getAttribute("aria-labelledby"), "logs-title");

  const title = container.querySelector<HTMLHeadingElement>("#logs-title");
  assert.ok(title, "logs title should exist");
  assert.equal(title?.textContent?.trim(), "Logs");

  const stub = container.querySelector("[data-testid='logs-empty-stub']");
  assert.ok(stub, "logs stub placeholder should exist");

  assert.equal(typeof cleanup, "function");
  cleanup();
});
