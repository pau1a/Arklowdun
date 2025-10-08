import { strict as assert } from "node:assert";
import test, { mock } from "node:test";
import { JSDOM } from "jsdom";
const bootstrapDom = new JSDOM("<!doctype html><html><body></body></html>");
const { window: bootstrapWindow } = bootstrapDom;
(globalThis as any).window = bootstrapWindow as unknown as typeof globalThis & Window;
(globalThis as any).document = bootstrapWindow.document;
(globalThis as any).HTMLElement = bootstrapWindow.HTMLElement;
(globalThis as any).Node = bootstrapWindow.Node;

import type { Category } from "../src/models.ts";
import { __resetCategories, setCategories } from "../src/store/categories.ts";

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
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const baseCategory = (overrides: Partial<Category> = {}): Category => ({
  id: overrides.id ?? "cat_primary",
  name: overrides.name ?? "Primary",
  slug: overrides.slug ?? "primary",
  color: overrides.color ?? "#4F46E5",
  household_id: overrides.household_id ?? "default",
  position: overrides.position ?? 0,
  z: overrides.z ?? 0,
  is_visible: overrides.is_visible ?? true,
  created_at: overrides.created_at ?? 0,
  updated_at: overrides.updated_at ?? 0,
  deleted_at: overrides.deleted_at ?? null,
});

const createSettingsOptions = () => ({
  householdId: "default",
  diagnostics: {
    fetchAboutMetadata: async () => ({
      appVersion: "1.0.0",
      commitHash: "deadbeefdeadbeef",
    }),
    fetchDiagnosticsSummary: async () => ({
      platform: "test",
      arch: "x64",
      appVersion: "1.0.0",
      commitHash: "deadbeefdeadbeef",
      rustLog: undefined,
      rustLogSource: undefined,
      logPath: "",
      logAvailable: false,
      logTail: [],
      logTruncated: false,
      logLinesReturned: 0,
      lines: [],
      dropped_count: 0,
      log_write_status: "ok",
    }),
    openDiagnosticsDoc: async () => {},
  },
  components: {
    createTimezoneMaintenanceSection: () => ({
      element: document.createElement("section"),
      destroy: () => {},
    }),
    createBackupView: () => ({
      element: document.createElement("section"),
      refresh: async () => {},
      destroy: () => {},
    }),
    createRepairView: () => ({
      element: document.createElement("section"),
      destroy: () => {},
    }),
    createExportView: () => ({
      element: document.createElement("section"),
      destroy: () => {},
    }),
    createImportView: () => ({
      element: document.createElement("section"),
      destroy: () => {},
    }),
    createHardRepairView: () => ({
      element: document.createElement("section"),
      destroy: () => {},
    }),
    createAmbientBackgroundSection: () => document.createElement("section"),
    createAttributionSectionAsync: async () => null,
  },
  useSettingsHook: async () => ({ data: null, error: null, isLoading: false }),
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

test("ManageView hides categories that are not visible", async () => {
  const container = document.createElement("div");
  const categories = [
    baseCategory({ id: "cat_secondary", name: "Secondary", slug: "secondary", position: 1 }),
    baseCategory({ id: "cat_hidden", name: "Hidden", slug: "hidden", position: 0, is_visible: false }),
  ];

  const { ManageView } = await import("../src/ManageView.ts");
  await ManageView(container, {
    householdId: "default",
    loadCategories: async () => categories,
  });

  const links = Array.from(
    container.querySelectorAll<HTMLAnchorElement>("nav.manage a"),
  ).map((link) => ({ id: link.id, href: link.getAttribute("href"), text: link.textContent }));

  assert.deepEqual(links, [{ id: "nav-secondary", href: "#secondary", text: "Secondary" }]);
});

test("ManageView reveals hidden categories when requested", async () => {
  const container = document.createElement("div");
  const categories = [
    baseCategory({ id: "cat_visible", name: "Active", slug: "active", position: 0 }),
    baseCategory({ id: "cat_hidden", name: "Archived", slug: "archived", position: 1, is_visible: false }),
  ];

  const toastModule = await import("../src/ui/Toast.ts");
  const toastMock = mock.method(toastModule.toast, "show", () => {});

  try {
    const { ManageView } = await import("../src/ManageView.ts");
    await ManageView(container, {
      householdId: "default",
      loadCategories: async () => categories,
    });
    await flush();

    const toggle = container.querySelector<HTMLButtonElement>(".manage__hidden-toggle");
    assert.ok(toggle, "toggle control renders");
    assert.equal(toggle?.textContent, "Show hidden categories");
    assert.equal(toggle?.getAttribute("aria-expanded"), "false");

    assert.equal(
      container.querySelectorAll<HTMLButtonElement>(".manage__tile--hidden").length,
      0,
      "hidden tiles are not shown by default",
    );

    toggle?.click();

    const hiddenTiles = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".manage__tile--hidden"),
    );
    assert.equal(hiddenTiles.length, 1, "hidden tile is displayed after toggle");
    assert.equal(hiddenTiles[0]?.textContent, "Archived");
    assert.equal(toggle?.textContent, "Hide hidden categories");
    assert.equal(toggle?.getAttribute("aria-expanded"), "true");

    hiddenTiles[0]?.click();
    assert.equal(toastMock.mock.calls.length, 1, "clicking hidden tile surfaces guidance");

    toggle?.click();
    assert.equal(toggle?.textContent, "Show hidden categories");
    assert.equal(toggle?.getAttribute("aria-expanded"), "false");
    assert.equal(
      container.querySelectorAll<HTMLButtonElement>(".manage__tile--hidden").length,
      0,
      "hidden tiles collapse when toggled again",
    );
  } finally {
    toastMock.mock.restore();
  }
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

test("ManageView updates when the categories store changes", async () => {
  const container = document.createElement("div");
  const categories = [
    baseCategory(),
    baseCategory({ id: "cat_tasks", name: "Tasks", slug: "tasks", position: 1 }),
  ];

  const { ManageView } = await import("../src/ManageView.ts");
  await ManageView(container, {
    householdId: "default",
    loadCategories: async () => categories,
  });

  let links = Array.from(
    container.querySelectorAll<HTMLAnchorElement>("nav.manage a"),
  ).map((link) => link.textContent);
  assert.deepEqual(links, ["Primary", "Tasks"]);

  setCategories([
    { ...categories[0], is_visible: false },
    categories[1],
  ]);
  await flush();

  links = Array.from(container.querySelectorAll<HTMLAnchorElement>("nav.manage a")).map(
    (link) => link.textContent,
  );
  assert.deepEqual(links, ["Tasks"]);
});

test("Settings toggles update ManageView visibility", async () => {
  const manageContainer = document.createElement("div");
  const settingsContainer = document.createElement("div");

  const categories = [
    baseCategory(),
    baseCategory({ id: "cat_tasks", name: "Tasks", slug: "tasks", position: 1 }),
  ];

  const categoriesModule = await import("../src/repos.ts");
  const listMock = mock.method(categoriesModule.categoriesRepo, "list", async () => categories);
  const updateMock = mock.method(categoriesModule.categoriesRepo, "update", async () => {});

  try {
    const { ManageView } = await import("../src/ManageView.ts");
    const { SettingsView } = await import("../src/SettingsView.ts");

    await ManageView(manageContainer, { householdId: "default" });
    await flush();

    assert.equal(listMock.mock.calls.length, 1);
    const [listArgs] = listMock.mock.calls[0].arguments;
    assert.equal(listArgs.includeHidden, true, "ManageView requests hidden categories");

    let navLinks = Array.from(
      manageContainer.querySelectorAll<HTMLAnchorElement>("nav.manage a"),
    ).map((link) => link.textContent);
    assert.deepEqual(navLinks, ["Primary", "Tasks"]);

    SettingsView(settingsContainer, createSettingsOptions());
    await flush();
    await flush();

    const toggles = settingsContainer.querySelectorAll<HTMLInputElement>(
      ".settings__category-toggle input[type=\"checkbox\"]",
    );
    assert.equal(toggles.length, 2, "settings renders category toggles");

    const firstToggle = toggles[0];
    firstToggle.checked = false;
    const changeEvent = new window.Event("change", { bubbles: true });
    firstToggle.dispatchEvent(changeEvent);
    await flush();
    await flush();

    navLinks = Array.from(
      manageContainer.querySelectorAll<HTMLAnchorElement>("nav.manage a"),
    ).map((link) => link.textContent);
    assert.deepEqual(navLinks, ["Tasks"], "ManageView reflects toggle state");

    const hiddenGroup = settingsContainer.querySelector<HTMLDivElement>(
      ".settings__categories-group--hidden",
    );
    assert.ok(hiddenGroup, "hidden group renders");
    assert.equal(hiddenGroup?.hidden, false, "hidden group remains accessible");

    assert.equal(updateMock.mock.calls.length, 1);
    const [householdId, categoryId, update] = updateMock.mock.calls[0].arguments;
    assert.equal(householdId, "default");
    assert.equal(categoryId, categories[0].id);
    assert.deepEqual(update, { is_visible: false });
  } finally {
    listMock.mock.restore();
    updateMock.mock.restore();
  }
});

test("SettingsView surfaces hidden-only state", async () => {
  const settingsContainer = document.createElement("div");
  const categories = [
    baseCategory({ is_visible: false }),
    baseCategory({ id: "cat_tasks", name: "Tasks", slug: "tasks", position: 1, is_visible: false }),
  ];

  const categoriesModule = await import("../src/repos.ts");
  const listMock = mock.method(categoriesModule.categoriesRepo, "list", async () => categories);

  try {
    const { SettingsView } = await import("../src/SettingsView.ts");
    SettingsView(settingsContainer, createSettingsOptions());
    await flush();
    await flush();

    assert.equal(listMock.mock.calls.length, 1);
    const [opts] = listMock.mock.calls[0].arguments;
    assert.equal(opts.includeHidden, true, "SettingsView requests hidden categories");

    const message = settingsContainer.querySelector(".settings__categories-message");
    assert.equal(
      message?.textContent,
      "All categories hidden — re-enable below.",
      "hidden-only message is shown",
    );

    const hiddenGroup = settingsContainer.querySelector<HTMLDivElement>(
      ".settings__categories-group--hidden",
    );
    assert.ok(hiddenGroup, "hidden categories group exists");
    assert.equal(hiddenGroup?.hidden, false, "hidden categories remain listed");
  } finally {
    listMock.mock.restore();
  }
});
