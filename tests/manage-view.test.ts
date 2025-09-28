import { strict as assert } from "node:assert";
import test from "node:test";
import { JSDOM } from "jsdom";
const bootstrapDom = new JSDOM("<!doctype html><html><body></body></html>");
const { window: bootstrapWindow } = bootstrapDom;
(globalThis as any).window = bootstrapWindow as unknown as typeof globalThis & Window;
(globalThis as any).document = bootstrapWindow.document;
(globalThis as any).HTMLElement = bootstrapWindow.HTMLElement;
(globalThis as any).Node = bootstrapWindow.Node;

import type { Category } from "../src/models.ts";

function setupDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { window } = dom;
  (globalThis as any).window = window as unknown as typeof globalThis & Window;
  (globalThis as any).document = window.document;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Node = window.Node;
}

test.beforeEach(() => {
  setupDom();
});

const baseCategory = (overrides: Partial<Category> = {}): Category => ({
  id: overrides.id ?? "cat_primary",
  name: overrides.name ?? "Primary",
  slug: overrides.slug ?? "primary",
  color: overrides.color ?? "#4F46E5",
  household_id: overrides.household_id ?? "default",
  position: overrides.position ?? 0,
  z: overrides.z ?? 0,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0,
  deleted_at: overrides.deleted_at ?? null,
});

test("ManageView renders categories from the loader", async () => {
  const container = document.createElement("div");
  const categories = [
    baseCategory(),
    baseCategory({ id: "cat_tasks", name: "Tasks", slug: "tasks", position: 1 }),
  ];

  const { ManageView } = await import("../src/ManageView.ts");
  await ManageView(container, {
    householdId: "default",
    loadCategories: async () => categories,
    onError: () => {
      throw new Error("unexpected error");
    },
  });

  const links = Array.from(
    container.querySelectorAll<HTMLAnchorElement>("nav.manage a"),
  ).map((link) => ({ id: link.id, href: link.getAttribute("href"), text: link.textContent }));

  assert.deepEqual(links, [
    { id: "nav-primary", href: "#primary", text: "Primary" },
    { id: "nav-tasks", href: "#tasks", text: "Tasks" },
  ]);
});

test("ManageView shows a fallback when no categories exist", async () => {
  const container = document.createElement("div");

  const { ManageView } = await import("../src/ManageView.ts");
  await ManageView(container, {
    householdId: "default",
    loadCategories: async () => [],
    onError: () => {
      throw new Error("unexpected error");
    },
  });

  const message = container.querySelector(".manage__empty");
  assert.ok(message);
  assert.equal(message?.textContent, "No categories available.");
});

test("ManageView surfaces loader failures", async () => {
  const container = document.createElement("div");
  const errors: unknown[] = [];

  const { ManageView } = await import("../src/ManageView.ts");
  await ManageView(container, {
    householdId: "default",
    loadCategories: async () => {
      throw new Error("boom");
    },
    onError: (err) => {
      errors.push(err);
    },
  });

  assert.equal(errors.length, 1);
  const failure = container.querySelector(".manage__error");
  assert.ok(failure);
  assert.equal(failure?.textContent, "Unable to load categories.");
});
