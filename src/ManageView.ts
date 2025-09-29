// src/ManageView.ts
import { defaultHouseholdId } from "./db/household";
import { categoriesRepo } from "./repos";
import { showError } from "./ui/errors";
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
  return categoriesRepo.list({ householdId, orderBy: "position, created_at, id" });
}

function isCategoryVisible(category: StoreCategory): boolean {
  return category.isVisible;
}

function renderNav(nav: HTMLElement, categories: StoreCategory[]) {
  nav.innerHTML = "";
  const sorted = [...categories].sort((a, b) => {
    if (a.position === b.position) return a.name.localeCompare(b.name);
    return a.position - b.position;
  });
  const visible = sorted.filter(isCategoryVisible);

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "manage__empty";
    empty.textContent = "No categories available.";
    nav.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  visible.forEach((category) => {
    const link = document.createElement("a");
    link.id = `nav-${category.slug}`;
    link.href = `#${category.slug}`;
    link.textContent = category.name;
    frag.appendChild(link);
  });
  nav.appendChild(frag);
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

  const initialCategories = getCategoryState();
  let hasResolvedInitialLoad = initialCategories.length > 0;
  if (hasResolvedInitialLoad) {
    renderNav(nav, initialCategories);
  } else {
    nav.innerHTML = "<p class=\"manage__loading\">Loading…</p>";
  }

  section.appendChild(nav);

  container.innerHTML = "";
  container.appendChild(section);

  const onError = options.onError ?? showError;
  let unsubscribed = false;
  const unsubscribeFromStore = subscribeToCategories((categories) => {
    if (unsubscribed) return;
    if (!hasResolvedInitialLoad && categories.length === 0) return;
    hasResolvedInitialLoad = true;
    renderNav(nav, categories);
  });
  registerViewCleanup(container, () => {
    unsubscribed = true;
    unsubscribeFromStore();
  });

  try {
    const householdId = options.householdId ?? (await defaultHouseholdId());
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
