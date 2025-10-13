export type PetsFocusAction = "search" | "create";

export interface PetsListController {
  focusCreate(): void;
  focusSearch(): void;
  submitCreateForm(): boolean;
  focusRow(id: string): void;
}

let currentController: PetsListController | null = null;
const pendingActions: PetsFocusAction[] = [];

function flushPending(): void {
  if (!currentController) return;
  while (pendingActions.length > 0) {
    const action = pendingActions.shift();
    if (!action) continue;
    if (action === "create") {
      currentController.focusCreate();
    } else {
      currentController.focusSearch();
    }
  }
}

export function registerPetsListController(controller: PetsListController): void {
  currentController = controller;
  flushPending();
}

export function unregisterPetsListController(controller: PetsListController): void {
  if (currentController !== controller) return;
  currentController = null;
}

export function requestPetsFocus(action: PetsFocusAction): void {
  if (currentController) {
    if (action === "create") {
      currentController.focusCreate();
    } else {
      currentController.focusSearch();
    }
    return;
  }
  if (!pendingActions.includes(action)) {
    pendingActions.push(action);
  }
}

export function getPetsListController(): PetsListController | null {
  return currentController;
}
