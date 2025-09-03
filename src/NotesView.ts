// TODO(backend-notes): when Notes move to SQLite, call the tauri `bring_note_to_front` command
// instead of local z-bumping, and order by `z DESC, position, created_at` in repo helpers.
import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { newUuidV7 } from "./db/id";

interface Note {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  z?: number;
  deleted_at?: number;
}

const STORE_DIR = "Arklowdun";
const FILE_NAME = "notes.json";

async function loadNotes(): Promise<Note[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    const notes = JSON.parse(json) as Note[] | any[];
    let changed = false;
    const fixed = notes.map((n) => {
      let note: any = n;
      if (typeof note.id === "number") {
        note = { ...note, id: newUuidV7() };
        changed = true;
      }
      if ("deletedAt" in note) {
        note.deleted_at = (note as any).deletedAt;
        delete (note as any).deletedAt;
        changed = true;
      }
      if (note.z === undefined) {
        note.z = 0;
        changed = true;
      }
      return note;
    });
    if (changed) await saveNotes(fixed);
    return fixed as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(notes, null, 2), { baseDir: BaseDirectory.AppLocalData });
}

export async function NotesView(container: HTMLElement) {
  const section = document.createElement("section");
  section.innerHTML = `
    <h2>Notes</h2>
    <form id="note-form">
      <input id="note-text" type="text" placeholder="Note" required />
      <input id="note-color" type="color" value="#ffff88" />
      <button type="submit">Add</button>
    </form>
    <div id="notes-canvas" class="notes-canvas"></div>
  `;
  container.innerHTML = "";
  container.appendChild(section);

  const form = section.querySelector<HTMLFormElement>("#note-form");
  const textInput = section.querySelector<HTMLInputElement>("#note-text");
  const colorInput = section.querySelector<HTMLInputElement>("#note-color");
  const canvas = section.querySelector<HTMLDivElement>("#notes-canvas")!;

  let notes: Note[] = await loadNotes();

  let saveTimer: number | undefined;
  const saveSoon = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveNotes(notes), 250);
  };

  function render() {
    canvas.innerHTML = "";
    notes
      .filter((n) => !n.deleted_at)
      .sort((a, b) => (a.z || 0) - (b.z || 0))
      .forEach((note) => {
        const el = document.createElement("div");
        el.className = "note";
        el.style.backgroundColor = note.color;
        el.style.left = note.x + "px";
        el.style.top = note.y + "px";
        el.style.zIndex = String(note.z || 0);
        const textarea = document.createElement("textarea");
        textarea.value = note.text;
        textarea.addEventListener("input", () => {
          note.text = textarea.value;
          saveSoon();
        });
        el.appendChild(textarea);
        const del = document.createElement("button");
        del.className = "delete";
        del.textContent = "\u00d7";
        del.addEventListener("click", () => {
          note.deleted_at = Date.now();
          saveNotes(notes).then(render);
        });
        el.appendChild(del);

        const bring = document.createElement("button");
        bring.className = "bring";
        bring.textContent = "\u2191";
        bring.addEventListener("click", () => {
          const maxZ = Math.max(0, ...notes.filter((n) => !n.deleted_at).map((n) => n.z || 0));
          note.z = maxZ + 1;
          saveNotes(notes).then(render);
        });
        el.appendChild(bring);

        el.addEventListener("pointerdown", (e) => {
          if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const origX = note.x;
          const origY = note.y;
          const maxZ = Math.max(0, ...notes.filter((n) => !n.deleted_at).map((n) => n.z || 0));
          note.z = maxZ + 1;
          el.style.zIndex = String(note.z);
          saveSoon();
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
          function onUp() {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup", onUp);
            el.classList.remove("dragging");
            saveSoon();
          }
          el.addEventListener("pointermove", onMove);
          el.addEventListener("pointerup", onUp);
        });

        canvas.appendChild(el);
      });
  }

  render();

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!textInput || !colorInput) return;
    const maxZ = Math.max(0, ...notes.filter((n) => !n.deleted_at).map((n) => n.z || 0));
    const note: Note = {
      id: newUuidV7(),
      text: textInput.value,
      color: colorInput.value,
      x: 10,
      y: 10,
      z: maxZ + 1,
    };
    notes.push(note);
    saveNotes(notes).then(render);
    form.reset();
    colorInput.value = "#ffff88";
  });
}
