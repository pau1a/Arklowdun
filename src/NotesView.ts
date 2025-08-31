import { readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";

interface Note {
  id: number;
  text: string;
  color: string;
  x: number;
  y: number;
}

const STORE_DIR = "Arklowdun";
const FILE_NAME = "notes.json";

async function loadNotes(): Promise<Note[]> {
  try {
    const p = await join(STORE_DIR, FILE_NAME);
    const json = await readTextFile(p, { baseDir: BaseDirectory.AppLocalData });
    return JSON.parse(json) as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(notes: Note[]): Promise<void> {
  await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
  const p = await join(STORE_DIR, FILE_NAME);
  await writeTextFile(p, JSON.stringify(notes, null, 2), { baseDir: BaseDirectory.AppLocalData });
}

let nextId = 1;

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
  nextId = notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;

  let saveTimer: number | undefined;
  const saveSoon = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveNotes(notes), 250);
  };

  function render() {
    canvas.innerHTML = "";
    notes.forEach((note) => {
      const el = document.createElement("div");
      el.className = "note";
      el.style.backgroundColor = note.color;
      el.style.left = note.x + "px";
      el.style.top = note.y + "px";
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
        notes = notes.filter((n) => n.id !== note.id);
        saveNotes(notes).then(render);
      });
      el.appendChild(del);

      el.addEventListener("pointerdown", (e) => {
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = note.x;
        const origY = note.y;
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
    const note: Note = {
      id: nextId++,
      text: textInput.value,
      color: colorInput.value,
      x: 10,
      y: 10,
    };
    notes.push(note);
    saveNotes(notes).then(render);
    form.reset();
    colorInput.value = "#ffff88";
  });
}
