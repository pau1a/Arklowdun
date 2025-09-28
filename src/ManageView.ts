// src/ManageView.ts
import { defaultHouseholdId } from "./db/household";
import { categoriesRepo } from "./repos";
import { showError } from "./ui/errors";
import type { Category } from "./models";

export interface ManageViewOptions {
  householdId?: string;
  loadCategories?: (householdId: string) => Promise<Category[]>;
  onError?: (error: unknown) => void;
}

async function fetchCategories(householdId: string): Promise<Category[]> {
  return categoriesRepo.list({ householdId, orderBy: "position, created_at, id" });
}

function renderNav(nav: HTMLElement, categories: Category[]) {
  nav.innerHTML = "";
  if (categories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "manage__empty";
    empty.textContent = "No categories available.";
    nav.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  categories.forEach((category) => {
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
  const section = document.createElement("section");
  section.className = "manage-page";

  const nav = document.createElement("nav");
  nav.className = "manage";
  nav.setAttribute("aria-label", "Manage categories");
  nav.innerHTML = "<p class=\"manage__loading\">Loading…</p>";

  section.appendChild(nav);

  container.innerHTML = "";
  container.appendChild(section);

  const onError = options.onError ?? showError;

  try {
    const householdId = options.householdId ?? (await defaultHouseholdId());
    const load = options.loadCategories ?? fetchCategories;
    const categories = await load(householdId);
    renderNav(nav, categories);
  } catch (err) {
    onError(err);
    nav.innerHTML = "";
    const failure = document.createElement("p");
    failure.className = "manage__error";
    failure.textContent = "Unable to load categories.";
    nav.appendChild(failure);
  }
}
