import { strict as assert } from "node:assert";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { Category } from "../src/models.ts";
import type { Note } from "../src/features/notes/model/Note.ts";
import { __resetCategories, setCategories } from "../src/store/categories.ts";
import { __resetStore } from "../src/store/index.ts";

const bootstrapDom = new JSDOM("<!doctype html><html><body></body></html>");
const { window: bootstrapWindow } = bootstrapDom;
(globalThis as any).window = bootstrapWindow as unknown as typeof globalThis & Window;
(globalThis as any).document = bootstrapWindow.document;
(globalThis as any).HTMLElement = bootstrapWindow.HTMLElement;
(globalThis as any).Node = bootstrapWindow.Node;

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
  __resetCategories();
  __resetStore();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const baseCategory = (overrides: Partial<Category> = {}): Category => ({
  id: overrides.id ?? "cat_primary",
  household_id: overrides.household_id ?? "default",
  name: overrides.name ?? "Primary",
  slug: overrides.slug ?? "primary",
  color: overrides.color ?? "#4F46E5",
  position: overrides.position ?? 0,
  z: overrides.z ?? 0,
  is_visible: overrides.is_visible ?? true,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0,
  deleted_at: overrides.deleted_at ?? null,
});

test("NotesView fetches notes with active category filters", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let invocation = 0;
  const loadNotes = async (options: Record<string, unknown> = {}) => {
    invocation += 1;
    const categoryIds = Array.isArray(options.categoryIds)
      ? (options.categoryIds as string[])
      : [];
    const note: Note = {
      id: `note-${invocation}`,
      text: "Mock",
      color: "#FFF4B8",
      x: 0,
      y: 0,
      z: 0,
      position: invocation - 1,
      household_id: "default",
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
      category_id: categoryIds[0] ?? null,
    };
    calls.push({ ...options });
    return { data: [note], error: null, isLoading: false };
  };

  try {
    setCategories([
      baseCategory(),
      baseCategory({
        id: "cat_tasks",
        name: "Tasks",
        slug: "tasks",
        position: 1,
        is_visible: false,
      }),
    ]);

    const { NotesView } = await import("../src/NotesView.ts");
    const container = document.createElement("div");
    await NotesView(container, { householdId: "default", loadNotes });
    await flush();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      householdId: "default",
      categoryIds: ["cat_primary"],
    });

    setCategories([
      baseCategory({ is_visible: false }),
      baseCategory({
        id: "cat_tasks",
        name: "Tasks",
        slug: "tasks",
        position: 1,
        is_visible: true,
      }),
    ]);
    await flush();
    await flush();

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], {
      householdId: "default",
      categoryIds: ["cat_tasks"],
    });

    setCategories([
      baseCategory({ is_visible: false }),
      baseCategory({
        id: "cat_tasks",
        name: "Tasks",
        slug: "tasks",
        position: 1,
        is_visible: false,
      }),
    ]);
    await flush();
    await flush();

    assert.equal(calls.length, 3);
    const thirdCall = calls[2];
    assert.equal(thirdCall.householdId, "default");
    assert.ok(
      !("categoryIds" in thirdCall) ||
        thirdCall.categoryIds === undefined ||
        (Array.isArray(thirdCall.categoryIds) && thirdCall.categoryIds.length === 0),
      "empty filters omit categoryIds",
    );
  } finally {
  }
});
