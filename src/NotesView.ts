// src/NotesView.ts
import { openDb } from "./db/open";
import { newUuidV7 } from "./db/id";
import { defaultHouseholdId } from "./db/household";
import { showError } from "./ui/errors";
import { NotesList, useNotes, type Note } from "@features/notes";
import {
  actions,
  selectors,
  subscribe,
  getState,
  type NotesSnapshot,
} from "./store";
import { emit, on } from "./store/events";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";
import createButton from "@ui/Button";
import createInput from "@ui/Input";

const NOTE_PALETTE: Record<string, { base: string; text: string }> = {
  "#FFFF88": { base: "#FFF4B8", text: "#2b2b2b" },
  "#FFF4B8": { base: "#FFF4B8", text: "#2b2b2b" },
  "#CFF7E3": { base: "#CFF7E3", text: "#1f2937" },
  "#DDEBFF": { base: "#DDEBFF", text: "#0f172a" },
  "#FFD9D3": { base: "#FFD9D3", text: "#1f2937" },
  "#EADCF9": { base: "#EADCF9", text: "#1f2937" },
  "#F6EBDC": { base: "#F6EBDC", text: "#1f2937" },
};

async function insertNote(
  householdId: string,
  draft: Omit<Note, "id" | "position">
): Promise<Note> {
  const db = await openDb();

  // Compute next free position and z in SQL to avoid unique collisions
  const nextPosRow = await db.select<{ next_pos: number }[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
       FROM notes
      WHERE household_id = ? AND deleted_at IS NULL`,
    [householdId]
  );
  const nextPos = nextPosRow[0]?.next_pos ?? 0;

  const nextZRow = await db.select<{ maxz: number }[]>(
    `SELECT COALESCE(MAX(z), 0) AS maxz
       FROM notes
      WHERE household_id = ? AND deleted_at IS NULL`,
    [householdId]
  );
  const z = (nextZRow[0]?.maxz ?? 0) + 1;

  const id = newUuidV7();
  const now = Date.now();

  await db.execute(
    `INSERT INTO notes
       (id, household_id, position, created_at, updated_at, deleted_at,
        z, text, color, x, y)
     VALUES
       (?,  ?,            ?,        ?,          ?,          NULL,
        ?, ?,    ?,     ?, ?)`,
    [
      id,
      householdId,
      nextPos,
      now,
      now,
      z,
      draft.text,
      draft.color,
      draft.x,
      draft.y,
    ]
  );

  return {
    id,
    text: draft.text,
    color: draft.color,
    x: draft.x,
    y: draft.y,
    z,
    position: nextPos,
    household_id: householdId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

async function updateNote(
  householdId: string,
  id: string,
  patch: Partial<Note>
): Promise<void> {
  const db = await openDb();
  const now = Date.now();

  const sets: string[] = [];
  const args: any[] = [];

  if (patch.text !== undefined) { sets.push("text = ?"); args.push(patch.text); }
  if (patch.color !== undefined) { sets.push("color = ?"); args.push(patch.color); }
  if (patch.x !== undefined) { sets.push("x = ?"); args.push(patch.x); }
  if (patch.y !== undefined) { sets.push("y = ?"); args.push(patch.y); }
  if (patch.z !== undefined) { sets.push("z = ?"); args.push(patch.z); }
  if (patch.deleted_at !== undefined) { sets.push("deleted_at = ?"); args.push(patch.deleted_at); }

  sets.push("updated_at = ?");
  args.push(now);

  args.push(householdId, id);

  await db.execute(
    `UPDATE notes SET ${sets.join(", ")} WHERE household_id = ? AND id = ?`,
    args
  );
}

export async function NotesView(container: HTMLElement) {
  runViewCleanups(container);

  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = "Notes";

  const form = document.createElement("form");
  form.id = "note-form";
  form.setAttribute("aria-label", "Create note");

  const textLabel = document.createElement("label");
  textLabel.className = "sr-only";
  textLabel.htmlFor = "note-text";
  textLabel.textContent = "Note text";
  const textInput = createInput({
    id: "note-text",
    type: "text",
    placeholder: "Note",
    ariaLabel: "Note text",
    required: true,
  });

  const colorLabel = document.createElement("label");
  colorLabel.className = "sr-only";
  colorLabel.htmlFor = "note-color";
  colorLabel.textContent = "Note color";
  const colorInput = createInput({
    id: "note-color",
    type: "color",
    value: "#FFF4B8",
    ariaLabel: "Note color",
  });

  const submitButton = createButton({
    label: "Add",
    variant: "primary",
    type: "submit",
  });

  form.append(textLabel, textInput, colorLabel, colorInput, submitButton);

  const notesBoard = NotesList();
  const canvas = notesBoard.element;

  section.append(heading, form, canvas);
  container.innerHTML = "";
  container.appendChild(section);

  let householdId = await defaultHouseholdId();

  const cloneNotes = (items: Note[]): Note[] => items.map((note) => ({ ...note }));
  let notesLocal: Note[] = cloneNotes(selectors.notes.items(getState()));

  let suppressNextRender = false;

  const saveSoon = (() => {
    let t: number | undefined;
    return (fn: () => void) => {
      if (t) clearTimeout(t);
      t = window.setTimeout(fn, 200);
    };
  })();

  const commitSnapshot = (
    source: string,
    emitEvent: boolean,
    suppressRender = false,
  ): void => {
    if (suppressRender) suppressNextRender = true;
    const payload = actions.notes.updateSnapshot({
      items: cloneNotes(notesLocal),
      ts: Date.now(),
      source,
    });
    if (emitEvent) emit("notes:updated", payload);
  };

  async function reload(source: string): Promise<void> {
    try {
      const result = await useNotes({ householdId });
      if (result.error) throw result.error;
      const loaded = result.data ?? [];
      notesLocal = cloneNotes(loaded);
      commitSnapshot(source, true, true);
      render();
    } catch (err) {
      showError(err);
    }
  }

  function render() {
    notesBoard.clear();
    notesLocal
      .filter((n) => !n.deleted_at)
      .sort((a, b) =>
        (b.z ?? 0) - (a.z ?? 0) ||
        a.position - b.position ||
        (a.created_at ?? 0) - (b.created_at ?? 0)
      )
      .forEach((note) => {
        const el = document.createElement("div");
        el.className = "note";
        const palette = NOTE_PALETTE[note.color.toUpperCase()];
        const baseColor = palette?.base ?? note.color;
        const textColor = palette?.text ?? "#1f2937";
        el.style.setProperty("--note-color", baseColor);
        el.style.setProperty("--note-text-color", textColor);
        el.style.left = note.x + "px";
        el.style.top = note.y + "px";
        el.style.zIndex = String(note.z ?? 0);

        const textarea = document.createElement("textarea");
        textarea.value = note.text;
        textarea.addEventListener("input", () => {
          note.text = textarea.value;
          commitSnapshot("notes:text-change", false, true);
          saveSoon(async () => {
            try {
              await updateNote(householdId, note.id, { text: note.text });
              commitSnapshot("notes:text-change", true, true);
            } catch {}
          });
        });
        el.appendChild(textarea);

        const deleteButton = createButton({
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "note__control note__control--delete",
          ariaLabel: "Delete note",
          children: "\u00d7",
          onClick: async (event) => {
            event.preventDefault();
            note.deleted_at = Date.now();
            try {
              await updateNote(householdId, note.id, { deleted_at: note.deleted_at });
              notesLocal = notesLocal.filter((n) => n.id !== note.id);
              commitSnapshot("notes:delete", true, true);
              render();
            } catch (err: any) {
              showError(err);
            }
          },
        });
        el.appendChild(deleteButton);

        const bringButton = createButton({
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "note__control note__control--bring",
          ariaLabel: "Bring note to front",
          children: "\u2191",
          onClick: async (event) => {
            event.preventDefault();
            const maxZ = Math.max(0, ...notesLocal.filter((n) => !n.deleted_at).map((n) => n.z ?? 0));
            note.z = maxZ + 1;
            commitSnapshot("notes:bring", false, true);
            try {
              await updateNote(householdId, note.id, { z: note.z });
              commitSnapshot("notes:bring", true, true);
              render();
            } catch (err: any) {
              showError(err);
            }
          },
        });
        el.appendChild(bringButton);

        el.addEventListener("pointerdown", (e) => {
          if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = note.x;
          const origY = note.y;
          const maxZ = Math.max(0, ...notesLocal.filter((n) => !n.deleted_at).map((n) => n.z ?? 0));
          note.z = maxZ + 1;
          el.style.zIndex = String(note.z);
          commitSnapshot("notes:drag", false, true);
          saveSoon(async () => {
            try {
              await updateNote(householdId, note.id, { z: note.z });
              commitSnapshot("notes:drag", true, true);
            } catch {}
          });
          el.classList.add("dragging");
          el.setPointerCapture(e.pointerId);
          function onMove(ev: PointerEvent) {
            const maxX = canvas.clientWidth - el.offsetWidth;
            const maxY = canvas.clientHeight - el.offsetHeight;
            note.x = Math.max(0, Math.min(maxX, origX + (ev.clientX - startX)));
            note.y = Math.max(0, Math.min(maxY, origY + (ev.clientY - startY)));
            el.style.left = note.x + "px";
            el.style.top = note.y + "px";
          }
          async function onUp() {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.classList.remove("dragging");
            try {
              await updateNote(householdId, note.id, { x: note.x, y: note.y });
              commitSnapshot("notes:drag", true, true);
            } catch {}
          }
          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerup", onUp);
        });

        canvas.appendChild(el);
      });
  }

  const unsubscribe = subscribe(selectors.notes.snapshot, (snapshot) => {
    if (suppressNextRender) {
      suppressNextRender = false;
      return;
    }
    const items = snapshot?.items ?? [];
    notesLocal = cloneNotes(items);
    render();
  });
  registerViewCleanup(container, unsubscribe);

  const stopHousehold = on("household:changed", async ({ householdId: next }) => {
    householdId = next;
    await reload("notes:household");
  });
  registerViewCleanup(container, stopHousehold);

  const initialSnapshot: NotesSnapshot | null = selectors.notes.snapshot(getState());
  if (initialSnapshot) {
    notesLocal = cloneNotes(initialSnapshot.items);
    render();
  } else {
    await reload("notes:init");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const created = await insertNote(householdId, {
        text: textInput.value,
        color: colorInput.value,
        x: 10,
        y: 10,
        z: 0,
        position: 0,
      } as any);
      notesLocal.push(created);
      commitSnapshot("notes:create", true, true);
      render();
      form.reset();
      colorInput.value = "#FFF4B8";
    } catch (err: any) {
      showError(err);
    }
  });
}
