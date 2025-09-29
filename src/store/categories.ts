import { categoriesRepo } from "../repos";
import type { Category } from "../models";

export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
  color: string;
  position: number;
  isVisible: boolean;
};

export type CategoryListener = (categories: StoreCategory[]) => void;
export type ActiveCategoryListener = (ids: string[]) => void;

const listeners = new Set<CategoryListener>();
const activeIdListeners = new Set<ActiveCategoryListener>();
let state: StoreCategory[] = [];

function cloneCategories(): StoreCategory[] {
  return state.map((entry) => ({ ...entry }));
}

function normaliseVisibility(
  value: Category["is_visible"] | number | null | undefined,
): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  return true;
}

function toStoreCategory(category: Category): StoreCategory {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    color: category.color,
    position: category.position,
    isVisible: normaliseVisibility(category.is_visible),
  };
}

function emit(): void {
  const snapshot = cloneCategories();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (err) {
      console.error(err);
    }
  });

  const activeIds = snapshot.filter((category) => category.isVisible).map((category) => category.id);
  activeIdListeners.forEach((listener) => {
    try {
      listener([...activeIds]);
    } catch (err) {
      console.error(err);
    }
  });
}

function setState(next: StoreCategory[]): void {
  state = next;
  emit();
}

export function subscribe(listener: CategoryListener): () => void {
  listeners.add(listener);
  listener(cloneCategories());
  return () => listeners.delete(listener);
}

export function getCategories(): StoreCategory[] {
  return cloneCategories();
}

export function getActiveCategories(): StoreCategory[] {
  return state.filter((category) => category.isVisible).map((entry) => ({ ...entry }));
}

export function getActiveCategoryIds(): string[] {
  return state.filter((category) => category.isVisible).map((category) => category.id);
}

export function subscribeActiveCategoryIds(listener: ActiveCategoryListener): () => void {
  activeIdListeners.add(listener);
  listener(getActiveCategoryIds());
  return () => {
    activeIdListeners.delete(listener);
  };
}

export function setCategories(categories: Category[]): void {
  setState(categories.map(toStoreCategory));
}

/** @internal test hook */
export function __resetCategories(): void {
  listeners.clear();
  activeIdListeners.clear();
  state = [];
}

export async function toggleCategory(
  householdId: string,
  id: string,
): Promise<void> {
  const index = state.findIndex((category) => category.id === id);
  if (index === -1) return;
  const nextVisible = !state[index].isVisible;
  const previous = state;
  const optimistic = state.map((category) =>
    category.id === id ? { ...category, isVisible: nextVisible } : category,
  );
  setState(optimistic);
  try {
    await categoriesRepo.update(householdId, id, { is_visible: nextVisible });
  } catch (err) {
    state = previous;
    emit();
    throw err;
  }
}

export async function updateCategory(
  householdId: string,
  id: string,
  patch: Partial<Pick<StoreCategory, "name" | "slug" | "color" | "position">> & {
    isVisible?: boolean;
  },
): Promise<void> {
  const index = state.findIndex((category) => category.id === id);
  if (index === -1) return;
  const nextVisible = patch.isVisible ?? state[index].isVisible;
  const update: Partial<Category> = {
    name: patch.name,
    slug: patch.slug,
    color: patch.color,
    position: patch.position,
    is_visible: nextVisible,
  };
  await categoriesRepo.update(householdId, id, update);
  const nextState = state.map((category) =>
    category.id === id
      ? {
          ...category,
          name: patch.name ?? category.name,
          slug: patch.slug ?? category.slug,
          color: patch.color ?? category.color,
          position: patch.position ?? category.position,
          isVisible: nextVisible,
        }
      : category,
  );
  setState(nextState);
}
