// src/ManageView.ts
import { getHouseholdIdForCalls } from "./db/household";
import { categoriesRepo } from "./repos";
import { showError } from "./ui/errors";
import { toast } from "./ui/Toast";
import type { Category } from "./models";
import {
  getCategories as getCategoryState,
  setCategories as storeCategories,
  subscribe as subscribeToCategories,
  type StoreCategory,
} from "./store/categories";
import { runViewCleanups, registerViewCleanup } from "./utils/viewLifecycle";

export interface ManageViewOptions {
  householdId?: string;
  loadCategories?: (householdId: string) => Promise<Category[]>;
  onError?: (error: unknown) => void;
}

async function fetchCategories(householdId: string): Promise<Category[]> {
  return categoriesRepo.list({
    householdId,
    orderBy: "position, created_at, id",
    includeHidden: true,
  });
}

function isCategoryVisible(category: StoreCategory): boolean {
  return category.isVisible;
}

type RenderNavResult = {
  hiddenCount: number;
  visibleCount: number;
};

function showHiddenCategoryGuidance(): void {
  toast.show({
    kind: "info",
    message: "Re-enable this category in Settings to manage it.",
  });
}

function syncHiddenToggle(
  button: HTMLButtonElement,
  footer: HTMLElement,
  showHidden: boolean,
  hiddenCount: number,
): boolean {
  const hasHidden = hiddenCount > 0;
  footer.hidden = !hasHidden;

  if (!hasHidden) {
    button.textContent = "Show hidden categories";
    button.setAttribute("aria-expanded", "false");
    return false;
  }

  button.textContent = showHidden
    ? "Hide hidden categories"
    : "Show hidden categories";
  button.setAttribute("aria-expanded", showHidden ? "true" : "false");
  return showHidden;
}

function renderNav(
  nav: HTMLElement,
  categories: StoreCategory[],
  options: {
    showHidden: boolean;
    onHiddenCategorySelect: (category: StoreCategory) => void;
  },
): RenderNavResult {
  nav.innerHTML = "";
  const sorted = [...categories].sort((a, b) => {
    if (a.position === b.position) return a.name.localeCompare(b.name);
    return a.position - b.position;
  });
  const visible = sorted.filter(isCategoryVisible);
  const hidden = sorted.filter((category) => !category.isVisible);

  if (visible.length === 0 && hidden.length === 0) {
    const empty = document.createElement("p");
    empty.className = "manage__empty";
    empty.textContent = "No categories available.";
    nav.appendChild(empty);
    return { hiddenCount: 0, visibleCount: 0 };
  }

  if (visible.length === 0 && hidden.length > 0 && !options.showHidden) {
    const empty = document.createElement("p");
    empty.className = "manage__empty";
    empty.textContent = "No visible categories. Show hidden to manage them.";
    nav.appendChild(empty);
    return { hiddenCount: hidden.length, visibleCount: 0 };
  }

  const frag = document.createDocumentFragment();
  sorted.forEach((category) => {
    if (!category.isVisible && !options.showHidden) {
      return;
    }

    if (category.isVisible) {
      const link = document.createElement("a");
      link.className = "manage__tile";
      link.id = `nav-${category.slug}`;
      link.href = `#${category.slug}`;
      link.textContent = category.name;
      frag.appendChild(link);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "manage__tile manage__tile--hidden";
    button.textContent = category.name;
    button.setAttribute("aria-disabled", "true");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      options.onHiddenCategorySelect(category);
    });
    frag.appendChild(button);
  });
  nav.appendChild(frag);

  return { hiddenCount: hidden.length, visibleCount: visible.length };
}

export async function ManageView(
  container: HTMLElement,
  options: ManageViewOptions = {},
): Promise<void> {
  runViewCleanups(container);

  const section = document.createElement("section");
  section.className = "manage-page";

  const nav = document.createElement("nav");
  nav.className = "manage";
  nav.setAttribute("aria-label", "Manage categories");

  const footer = document.createElement("div");
  footer.className = "manage__footer";
  const toggleHiddenButton = document.createElement("button");
  toggleHiddenButton.type = "button";
  toggleHiddenButton.className = "manage__hidden-toggle";
  toggleHiddenButton.textContent = "Show hidden categories";
  toggleHiddenButton.setAttribute("aria-expanded", "false");
  footer.appendChild(toggleHiddenButton);
  footer.hidden = true;

  let showHidden = false;

  const initialCategories = getCategoryState();
  let hasResolvedInitialLoad = initialCategories.length > 0;
  if (hasResolvedInitialLoad) {
    const { hiddenCount } = renderNav(nav, initialCategories, {
      showHidden,
      onHiddenCategorySelect: showHiddenCategoryGuidance,
    });
    showHidden = syncHiddenToggle(
      toggleHiddenButton,
      footer,
      showHidden,
      hiddenCount,
    );
  } else {
    nav.innerHTML = "<p class=\"manage__loading\">Loading…</p>";
  }

  toggleHiddenButton.addEventListener("click", (event) => {
    event.preventDefault();
    showHidden = !showHidden;
    const snapshot = getCategoryState();
    const { hiddenCount } = renderNav(nav, snapshot, {
      showHidden,
      onHiddenCategorySelect: showHiddenCategoryGuidance,
    });
    showHidden = syncHiddenToggle(
      toggleHiddenButton,
      footer,
      showHidden,
      hiddenCount,
    );
  });

  section.append(nav, footer);

  container.innerHTML = "";
  container.appendChild(section);

  const onError = options.onError ?? showError;
  let unsubscribed = false;
  const unsubscribeFromStore = subscribeToCategories((categories) => {
    if (unsubscribed) return;
    if (!hasResolvedInitialLoad && categories.length === 0) return;
    hasResolvedInitialLoad = true;
    const { hiddenCount } = renderNav(nav, categories, {
      showHidden,
      onHiddenCategorySelect: showHiddenCategoryGuidance,
    });
    showHidden = syncHiddenToggle(
      toggleHiddenButton,
      footer,
      showHidden,
      hiddenCount,
    );
  });
  registerViewCleanup(container, () => {
    unsubscribed = true;
    unsubscribeFromStore();
  });

  try {
    const householdId = options.householdId ?? (await getHouseholdIdForCalls());
    const load = options.loadCategories ?? fetchCategories;
    const categories = await load(householdId);
    hasResolvedInitialLoad = true;
    storeCategories(categories);
  } catch (err) {
    onError(err);
    unsubscribed = true;
    unsubscribeFromStore();
    nav.innerHTML = "";
    const failure = document.createElement("p");
    failure.className = "manage__error";
    failure.textContent = "Unable to load categories.";
    nav.appendChild(failure);
  }
}
