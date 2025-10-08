export type NotesViewMode = "grid" | "list";

export interface NotesListInstance {
  element: HTMLDivElement;
  clear(): void;
  setViewMode(mode: NotesViewMode): void;
}

export function NotesList(initialMode: NotesViewMode = "grid"): NotesListInstance {
  const element = document.createElement("div");
  element.id = "notes-canvas";
  element.className = "notes-canvas";

  const applyMode = (mode: NotesViewMode) => {
    element.classList.toggle("notes-canvas--masonry", mode === "grid");
    element.classList.toggle("notes-canvas--list", mode === "list");
  };

  applyMode(initialMode);

  return {
    element,
    clear() {
      element.innerHTML = "";
    },
    setViewMode(mode: NotesViewMode) {
      applyMode(mode);
    },
  };
}

export default NotesList;
