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
try {
  // Delete any existing non-configurable navigator accessor before redefining below.
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test bootstrap shim
  delete (globalThis as any).navigator;
} catch {
  // ignore if deletion is disallowed; defineProperty below will overwrite when possible
}
Object.defineProperty(globalThis, "navigator", {
  value: bootstrapWindow.navigator,
  configurable: true,
});

test.beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { window } = dom;
  (globalThis as any).window = window as unknown as typeof globalThis & Window;
  (globalThis as any).document = window.document;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Node = window.Node;
  try {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test bootstrap shim
    delete (globalThis as any).navigator;
  } catch {
    // ignore if not deletable
  }
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  });
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

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: overrides.id ?? `note-${Math.random().toString(16).slice(2)}`,
  text: overrides.text ?? "Sample",
  color: overrides.color ?? "#FFF4B8",
  x: overrides.x ?? 0,
  y: overrides.y ?? 0,
  z: overrides.z ?? 0,
  position: overrides.position ?? 0,
  household_id: overrides.household_id ?? "default",
  category_id: overrides.category_id ?? "cat_primary",
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
  deleted_at: overrides.deleted_at ?? null,
  deadline: overrides.deadline ?? null,
  deadline_tz: overrides.deadline_tz ?? null,
});

test("NotesView renders text, color, and deadline", async () => {
  setCategories([baseCategory()]);
  const note = makeNote({
    text: "Render me",
    color: "#CFF7E3",
    deadline: Date.UTC(2024, 0, 1, 12, 0),
    deadline_tz: "UTC",
  });
  const loadNotes = async () => ({
    data: { notes: [note], next_cursor: null },
    error: null,
    isLoading: false,
  });

  const { NotesView } = await import("../src/NotesView.ts");
  const container = document.createElement("div");
  await NotesView(container, { householdId: "default", loadNotes });
  await flush();

  const textarea = container.querySelector("textarea");
  assert.ok(textarea, "note textarea rendered");
  assert.equal(textarea?.value, "Render me");

  const noteEl = container.querySelector<HTMLDivElement>(".note");
  assert.ok(noteEl, "note element present");
  assert.equal(noteEl?.style.getPropertyValue("--note-color"), "#CFF7E3");

  const deadlineEl = container.querySelector(".note__deadline-inline span");
  assert.ok(deadlineEl, "deadline text rendered");
  assert.ok(deadlineEl?.textContent?.includes("Due"));
});

test("NotesView load more fetches subsequent cursor", async () => {
  setCategories([baseCategory()]);
  const calls: Array<Record<string, unknown>> = [];
  const pageOne = [makeNote({ id: "note-1", text: "First" })];
  const pageTwo = [makeNote({ id: "note-2", text: "Second", position: 1 })];
  const loadNotes = async (options: Record<string, unknown> = {}) => {
    calls.push({ ...options });
    if (!options.afterCursor) {
      return {
        data: { notes: pageOne, next_cursor: "cursor-1" },
        error: null,
        isLoading: false,
      };
    }
    return {
      data: { notes: pageTwo, next_cursor: null },
      error: null,
      isLoading: false,
    };
  };

  const { NotesView } = await import("../src/NotesView.ts");
  const container = document.createElement("div");
  await NotesView(container, { householdId: "default", loadNotes });
  await flush();

  const button = container.querySelector<HTMLButtonElement>(".notes__pagination button");
  assert.ok(button, "load more button rendered");

  button?.click();
  await flush();

  assert.equal(calls.length, 2);
  assert.equal((calls[1] as any).afterCursor, "cursor-1");

  const notes = container.querySelectorAll(".note");
  assert.equal(notes.length, 2, "both pages rendered");
});

test("Hidden categories hide notes", async () => {
  setCategories([
    baseCategory({ id: "cat_primary", name: "Primary" }),
    baseCategory({ id: "cat_secondary", name: "Secondary", slug: "secondary", position: 1 }),
  ]);
  const calls: Array<Record<string, unknown>> = [];
  const loadNotes = async (options: Record<string, unknown> = {}) => {
    calls.push({ ...options });
    return {
      data: {
        notes: [
          makeNote({ id: "note-1", text: "Primary note", category_id: "cat_primary" }),
          makeNote({ id: "note-2", text: "Secondary note", category_id: "cat_secondary", position: 1 }),
        ],
        next_cursor: null,
      },
      error: null,
      isLoading: false,
    };
  };

  const { NotesView } = await import("../src/NotesView.ts");
  const container = document.createElement("div");
  await NotesView(container, { householdId: "default", loadNotes });
  await flush();

  let rendered = container.querySelectorAll(".note");
  assert.equal(rendered.length, 2, "all notes visible when categories active");

  setCategories([
    baseCategory({ id: "cat_primary", name: "Primary", is_visible: true }),
    baseCategory({ id: "cat_secondary", name: "Secondary", slug: "secondary", position: 1, is_visible: false }),
  ]);
  await flush();
  await flush();

  rendered = container.querySelectorAll(".note");
  assert.equal(rendered.length, 1, "hidden category notes removed");
  const visibleTextarea = container.querySelector("textarea");
  assert.equal(visibleTextarea?.value, "Primary note");

  setCategories([
    baseCategory({ id: "cat_primary", name: "Primary", is_visible: false }),
    baseCategory({ id: "cat_secondary", name: "Secondary", slug: "secondary", position: 1, is_visible: false }),
  ]);
  await flush();
  await flush();

  rendered = container.querySelectorAll(".note");
  assert.equal(rendered.length, 0, "no notes when all categories hidden");
  assert.ok(calls.length >= 2, "reload invoked on category changes");
});

test("Quick capture shortcut creates note and closes modal", async () => {
  setCategories([baseCategory()]);
  const createdPayloads: Array<Record<string, unknown>> = [];
  const loadNotes = async () => ({
    data: { notes: [], next_cursor: null },
    error: null,
    isLoading: false,
  });
  const createNote = async (_householdId: string, input: Record<string, unknown>) => {
    createdPayloads.push({ ...input });
    return makeNote({
      id: "note-captured",
      text: String(input.text ?? ""),
      category_id: (input.category_id as string | null) ?? "cat_primary",
      deadline: (input.deadline as number | null) ?? null,
      deadline_tz: (input.deadline_tz as string | null) ?? null,
      position: Number(input.position ?? 0),
    });
  };

  const { NotesView } = await import("../src/NotesView.ts");
  const container = document.createElement("div");
  await NotesView(container, { householdId: "default", loadNotes, createNote });
  await flush();

  const event = new window.KeyboardEvent("keydown", {
    key: "k",
    shiftKey: true,
    metaKey: true,
    ctrlKey: true,
    bubbles: true,
  });
  window.dispatchEvent(event);
  await flush();
  await flush();

  const textInput = document.getElementById("quick-capture-text") as HTMLInputElement | null;
  assert.ok(textInput, "quick capture text input present");
  textInput!.value = "Captured via shortcut";

  const deadlineInput = document.getElementById("quick-capture-deadline") as HTMLInputElement | null;
  assert.ok(deadlineInput, "deadline input present");
  deadlineInput!.value = "2024-01-01T12:00";

  const form = document.querySelector(".notes__quick-capture-form") as HTMLFormElement | null;
  assert.ok(form, "quick capture form present");
  form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await flush();

  assert.equal(createdPayloads.length, 1, "create note invoked once");
  const payload = createdPayloads[0];
  assert.equal(payload.text, "Captured via shortcut");
  assert.equal(payload.category_id, "cat_primary");
  assert.ok(typeof payload.deadline === "number");

  const modalDialog = document.querySelector(".notes__quick-capture-dialog");
  assert.equal(modalDialog, null, "modal closed after capture");

  const toastRegion = document.getElementById("ui-toast-region");
  assert.ok(toastRegion, "toast region created");
  assert.ok(toastRegion?.textContent?.includes("Note captured."));

  const notes = container.querySelectorAll(".note");
  assert.equal(notes.length, 1, "captured note rendered");
  const textarea = container.querySelector("textarea");
  assert.equal(textarea?.value, "Captured via shortcut");
});
