export interface ContentInstance {
  element: HTMLElement;
  bannerHost: HTMLElement;
  view: HTMLElement;
}

export function Content(): ContentInstance {
  const main = document.createElement("main");
  main.id = "view";
  main.className = "container";
  main.setAttribute("role", "main");

  const bannerHost = document.createElement("div");
  bannerHost.className = "container__banner";
  bannerHost.dataset.slot = "db-health-banner";
  bannerHost.hidden = true;

  const view = document.createElement("div");
  view.className = "container__view";

  main.append(bannerHost, view);

  return { element: main, bannerHost, view };
}

