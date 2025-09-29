import { strict as assert } from "node:assert";
import test from "node:test";

import type { Category } from "../src/models.ts";
import {
  setCategories,
  subscribeActiveCategoryIds,
  getActiveCategoryIds,
  __resetCategories,
} from "../src/store/categories.ts";
import {
  actions,
  selectors,
  getState,
  __resetStore,
} from "../src/store/index.ts";

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

test.beforeEach(() => {
  __resetCategories();
  __resetStore();
});

test("categories store publishes active ids and snapshots retain filters", () => {
  const events: string[][] = [];
  const unsubscribe = subscribeActiveCategoryIds((ids) => {
    events.push(ids);
  });

  const categories: Category[] = [
    baseCategory(),
    baseCategory({
      id: "cat_tasks",
      name: "Tasks",
      slug: "tasks",
      color: "#0EA5E9",
      position: 1,
    }),
  ];

  setCategories(categories);
  setCategories([
    categories[0],
    { ...categories[1], is_visible: false },
  ]);

  unsubscribe();

  assert.deepEqual(events[0], [], "subscription emits initial empty state");
  assert.deepEqual(events[1], ["cat_primary", "cat_tasks"], "initial categories populate active ids");
  assert.deepEqual(events[2], ["cat_primary"], "visibility change removes hidden category");
  assert.deepEqual(getActiveCategoryIds(), ["cat_primary"], "getter reflects latest active ids");

  const payload = actions.notes.updateSnapshot({
    items: [],
    ts: Date.now(),
    source: "test",
    activeCategoryIds: ["cat_primary"],
  });

  assert.deepEqual(payload.activeCategoryIds, ["cat_primary"], "snapshot payload exposes active ids");

  const snapshot = selectors.notes.snapshot(getState());
  assert.ok(snapshot, "notes snapshot stored");
  assert.deepEqual(snapshot?.activeCategoryIds, ["cat_primary"], "notes snapshot retains active category ids");
});
