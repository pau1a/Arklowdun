import { createButton } from "@ui/Button";

export interface ToolbarAction {
  id: string;
  label: string;
  onSelect: () => void;
  icon?: string;
}

export function createToolbarShell(
  title: string,
  actions: ToolbarAction[] = [],
): HTMLElement {
  const root = document.createElement("div");
  root.className = "app-toolbar";

  const heading = document.createElement("h1");
  heading.textContent = title;
  heading.className = "app-toolbar__title";
  root.append(heading);

  if (actions.length > 0) {
    const actionBar = document.createElement("div");
    actionBar.className = "app-toolbar__actions";
    for (const action of actions) {
      const button = createButton(action.label, {
        variant: "primary",
        icon: action.icon,
        onClick: action.onSelect,
      });
      button.classList.add("app-toolbar__action");
      button.dataset.actionId = action.id;
      actionBar.append(button);
    }
    root.append(actionBar);
  }

  return root;
}
