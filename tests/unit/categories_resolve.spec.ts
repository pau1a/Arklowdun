import { strict as assert } from "node:assert";
import test, { mock } from "node:test";

import type { Category } from "../../src/models.ts";
import { resolveQuickCaptureCategory } from "../../src/components/calendar/CalendarNotesPanel.tsx";
import * as categoriesStore from "../../src/store/categories.ts";
import * as reposModule from "../../src/repos.ts";

const baseCategory = (overrides: Partial<Category> = {}): Category => ({
  id: overrides.id ?? "cat_primary",
  name: overrides.name ?? "Primary",
  slug: overrides.slug ?? "primary",
  color: overrides.color ?? "#4F46E5",
  household_id: overrides.household_id ?? "hh-test",
  position: overrides.position ?? 0,
  z: overrides.z ?? 0,
  is_visible: overrides.is_visible ?? true,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0,
  deleted_at: overrides.deleted_at ?? null,
});

test.beforeEach(() => {
  categoriesStore.__resetCategories();
});

test.afterEach(() => {
  mock.restoreAll();
  categoriesStore.__resetCategories();
});

test("resolveQuickCaptureCategory fetches categories when store is empty", async () => {
  const category = baseCategory();

  const listMock = mock.method(reposModule.categoriesRepo, "list", async () => [category]);

  const categoryId = await resolveQuickCaptureCategory();

  assert.equal(listMock.mock.calls.length, 1);
  const [callArgs] = listMock.mock.calls[0].arguments as [
    { householdId: string } & Record<string, unknown>,
  ];
  assert.equal(callArgs.householdId, "default");
  assert.equal(categoryId, category.id);

  const snapshot = categoriesStore.getCategories();
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0]?.id, category.id);
});
