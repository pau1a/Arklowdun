export interface PageShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  toolbar: HTMLElement;
  content: HTMLElement;
}

export function createPageShell(): PageShell {
  const root = document.createElement("div");
  root.className = "app-page";

  const sidebar = document.createElement("aside");
  sidebar.className = "app-page__sidebar";

  const main = document.createElement("div");
  main.className = "app-page__main";

  const toolbar = document.createElement("header");
  toolbar.className = "app-page__toolbar";

  const content = document.createElement("main");
  content.className = "app-page__content";

  main.append(toolbar, content);
  root.append(sidebar, main);

  return { root, sidebar, toolbar, content };
}
