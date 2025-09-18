export interface ToolbarInstance {
  element: HTMLElement;
}

export function Toolbar(): ToolbarInstance {
  const header = document.createElement("header");
  header.id = "titlebar";
  header.className = "toolbar";
  header.setAttribute("role", "banner");
  header.hidden = true;
  return { element: header };
}

