export type FamilyDrawerTabId = "personal" | "finance" | "audit";

export interface DrawerTabDefinition {
  id: FamilyDrawerTabId;
  label: string;
  panel: HTMLElement;
}

export interface DrawerTabsInstance {
  element: HTMLElement;
  panelsHost: HTMLElement;
  readonly activeId: FamilyDrawerTabId;
  setActive(id: FamilyDrawerTabId): void;
  setHasError(id: FamilyDrawerTabId, hasError: boolean): void;
}

const ERROR_DOT_CLASS = "family-drawer__tab-error";

export function createDrawerTabs(definitions: DrawerTabDefinition[]): DrawerTabsInstance {
  if (definitions.length === 0) {
    throw new Error("Family drawer tabs require at least one tab definition.");
  }

  const element = document.createElement("div");
  element.className = "family-drawer__tabs";

  const list = document.createElement("div");
  list.className = "family-drawer__tablist";
  list.setAttribute("role", "tablist");
  element.appendChild(list);

  const panelsHost = document.createElement("div");
  panelsHost.className = "family-drawer__panels";
  element.appendChild(panelsHost);

  let activeId: FamilyDrawerTabId = definitions[0].id;
  const buttons = new Map<FamilyDrawerTabId, HTMLButtonElement>();

  const setActive = (id: FamilyDrawerTabId) => {
    if (activeId === id) return;
    activeId = id;
    syncState();
  };

  const syncState = () => {
    for (const definition of definitions) {
      const button = buttons.get(definition.id);
      const selected = definition.id === activeId;
      if (button) {
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
      }
      definition.panel.hidden = !selected;
    }
  };

  const focusButton = (id: FamilyDrawerTabId) => {
    const button = buttons.get(id);
    if (button) {
      button.focus();
    }
  };

  for (const definition of definitions) {
    if (!definition.panel.id) {
      definition.panel.id = `family-drawer-panel-${definition.id}`;
    }
    definition.panel.setAttribute("role", "tabpanel");
    definition.panel.setAttribute("aria-labelledby", `family-drawer-tab-${definition.id}`);
    panelsHost.appendChild(definition.panel);

    const button = document.createElement("button");
    button.type = "button";
    button.id = `family-drawer-tab-${definition.id}`;
    button.className = "family-drawer__tab";
    button.textContent = definition.label;
    button.dataset.tabId = definition.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", definition.panel.id);
    button.setAttribute("aria-selected", definition.id === activeId ? "true" : "false");
    button.tabIndex = definition.id === activeId ? 0 : -1;

    button.addEventListener("click", (event) => {
      event.preventDefault();
      setActive(definition.id);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const currentIndex = definitions.findIndex((item) => item.id === definition.id);
        const next = definitions[(currentIndex + 1) % definitions.length];
        setActive(next.id);
        focusButton(next.id);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = definitions.findIndex((item) => item.id === definition.id);
        const prev = definitions[(currentIndex - 1 + definitions.length) % definitions.length];
        setActive(prev.id);
        focusButton(prev.id);
      }
    });
    list.appendChild(button);
    buttons.set(definition.id, button);
  }

  syncState();

  const setHasError = (id: FamilyDrawerTabId, hasError: boolean) => {
    const button = buttons.get(id);
    if (!button) return;
    button.toggleAttribute("data-tab-error", hasError);
    button.classList.toggle(ERROR_DOT_CLASS, hasError);
  };

  return {
    element,
    panelsHost,
    get activeId() {
      return activeId;
    },
    setActive(id) {
      if (activeId === id) return;
      activeId = id;
      syncState();
      focusButton(id);
    },
    setHasError,
  };
}
