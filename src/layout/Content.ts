export interface ContentShell {
  root: HTMLElement;
  setView(view: HTMLElement): void;
}

export function createContentShell(): ContentShell {
  const root = document.createElement("section");
  root.className = "app-content";

  function setView(view: HTMLElement): void {
    root.replaceChildren(view);
  }

  return { root, setView };
}
