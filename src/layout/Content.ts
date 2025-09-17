export interface ContentInstance {
  element: HTMLElement;
}

export function Content(): ContentInstance {
  const main = document.createElement("main");
  main.id = "view";
  main.className = "container";
  main.setAttribute("role", "main");
  return { element: main };
}

