// src/NotesView.ts
import Database from "@tauri-apps/plugin-sql";
import { newUuidV7 } from "./db/id";
import { defaultHouseholdId } from "./db/household";

type Note = {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  z?: number;
  position: number;
  household_id?: string;
  created_at?: number;
  updated_at?: number;
  deleted_at?: number | null;
};

async function openDb() {
  // Uses the same DB the rest of the app uses (tauri config maps this to your app.sqlite)
  // Do NOT put an absolute path here.
  return await Database.load("sqlite:app.sqlite");
}

async function loadNotes(householdId: string): Promise<Note[]> {
  const db = await openDb();
  const rows = await db.select<Note[]>(
    `SELECT id, text, color, x, y, z, position, household_id, created_at, updated_at, deleted_at
       FROM notes
      WHERE household_id = ? AND deleted_at IS NULL
      ORDER BY COALESCE(z,0) DESC, position, created_at, id`,
    [householdId]
  );
  return rows ?? [];
}

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
  const section = document.createElement("section");
  section.className = "notes";
  section.innerHTML = `
    <header class="notes__header">
      <div>
        <h2>Notes</h2>
        <p id="notes-subhead" class="kicker">Your notes at a glance</p>
      </div>
      <div class="notes__actions">
        <div class="notes__search">
          <span class="notes__search-icon">\u{1F50D}</span>
          <input id="note-search" type="search" placeholder="Search notes" />
        </div>
        <button id="new-note" class="btn btn--accent">New Note</button>
      </div>
    </header>
    <div class="notes__layout">
      <div id="notes-list" class="card notes__list"></div>
      <div id="notes-editor" class="card notes__editor" hidden>
        <input id="note-title" class="notes__title" type="text" placeholder="Title" />
        <textarea id="note-body" class="notes__body" placeholder="Write your note..."></textarea>
        <div class="notes__editor-actions">
          <button id="delete-note" class="btn">Delete</button>
        </div>
      </div>
    </div>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const listEl = section.querySelector<HTMLDivElement>("#notes-list")!;
  const editorEl = section.querySelector<HTMLDivElement>("#notes-editor")!;
  const titleInput = section.querySelector<HTMLInputElement>("#note-title")!;
  const bodyInput = section.querySelector<HTMLTextAreaElement>("#note-body")!;
  const deleteBtn = section.querySelector<HTMLButtonElement>("#delete-note")!;
  const newBtn = section.querySelector<HTMLButtonElement>("#new-note")!;
  const subhead = section.querySelector<HTMLElement>("#notes-subhead")!;

  const householdId = await defaultHouseholdId();
  let notes: Note[] = await loadNotes(householdId);
  let selected: Note | null = null;

  const saveSoon = (() => {
    let t: number | undefined;
    return (fn: () => void) => {
      if (t) clearTimeout(t);
      t = window.setTimeout(fn, 200);
    };
  })();

  function updateSubhead() {
    subhead.textContent = `Your notes at a glance${
      notes.length ? " • " + notes.length + " notes" : ""
    }`;
  }

  function renderList() {
    listEl.innerHTML = "";
    const activeNotes = notes.filter((n) => !n.deleted_at);
    if (activeNotes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "notes__empty";
      empty.innerHTML = `<p>No notes yet</p><button class="btn btn--ghost">New Note</button>`;
      empty
        .querySelector("button")
        ?.addEventListener("click", () => newBtn.click());
      listEl.appendChild(empty);
      editorEl.hidden = true;
      updateSubhead();
      return;
    }
    activeNotes
      .sort(
        (a, b) =>
          (b.updated_at ?? 0) - (a.updated_at ?? 0) ||
          (a.created_at ?? 0) - (b.created_at ?? 0)
      )
      .forEach((note) => {
        const row = document.createElement("div");
        row.className = "notes__row";
        row.tabIndex = 0;
        row.dataset.id = note.id;
        const main = document.createElement("div");
        main.className = "notes__row-main";
        const titleEl = document.createElement("div");
        titleEl.className = "notes__row-title";
        const previewEl = document.createElement("div");
        previewEl.className = "notes__row-preview";
        const [first, ...rest] = (note.text || "").split("\n");
        titleEl.textContent = first || "Untitled";
        previewEl.textContent = rest.join(" ").split("\n")[0];
        main.append(titleEl, previewEl);
        const time = document.createElement("time");
        time.className = "notes__row-time";
        const ts = note.updated_at || note.created_at;
        time.textContent = ts ? new Date(ts).toLocaleDateString() : "";
        row.append(main, time);
        row.addEventListener("click", () => selectNote(note));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter") selectNote(note);
        });
        listEl.appendChild(row);
      });
    updateSubhead();
  }

  function selectNote(note: Note) {
    selected = note;
    listEl
      .querySelectorAll<HTMLElement>(".notes__row")
      .forEach((el) => {
        el.classList.toggle("active", el.dataset.id === note.id);
      });
    editorEl.hidden = false;
    const [first, ...rest] = (note.text || "").split("\n");
    titleInput.value = first || "";
    bodyInput.value = rest.join("\n");
    titleInput.focus();
  }

  function save() {
    if (!selected) return;
    selected.text = [titleInput.value, bodyInput.value]
      .filter(Boolean)
      .join("\n");
    selected.updated_at = Date.now();
    updateNote(householdId, selected.id, { text: selected.text }).catch(() => {});
    renderList();
  }

  titleInput.addEventListener("input", () => saveSoon(save));
  bodyInput.addEventListener("input", () => saveSoon(save));

  deleteBtn.addEventListener("click", async () => {
    if (!selected) return;
    selected.deleted_at = Date.now();
    try {
      await updateNote(householdId, selected.id, {
        deleted_at: selected.deleted_at,
      });
      notes = notes.filter((n) => n.id !== selected!.id);
      selected = null;
      renderList();
      editorEl.hidden = true;
    } catch (err: any) {
      alert(`Failed to delete note:\n${err?.message ?? String(err)}`);
    }
  });

  newBtn.addEventListener("click", async () => {
    try {
      const created = await insertNote(householdId, {
        text: "",
        color: "#ffff88",
        x: 0,
        y: 0,
        z: 0,
        position: 0,
      } as any);
      notes = [created, ...notes];
      renderList();
      selectNote(created);
    } catch (err: any) {
      alert(`Failed to add note:\n${err?.message ?? String(err)}`);
    }
  });

  renderList();
}
