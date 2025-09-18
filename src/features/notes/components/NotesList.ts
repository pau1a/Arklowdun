export interface NotesListInstance {
  element: HTMLDivElement;
  clear(): void;
}

export function NotesList(): NotesListInstance {
  const element = document.createElement("div");
  element.id = "notes-canvas";
  element.className = "notes-canvas";

  return {
    element,
    clear() {
      element.innerHTML = "";
    },
  };
}

export default NotesList;
