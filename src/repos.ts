// src/repos.ts
import { call } from "@lib/ipc/call";
import { clearSearchCache } from "./services/searchRepo";

import type {
  Bill,
  Policy,
  PropertyDocument,
  Pet,
  PetMedicalRecord,
  FamilyMember,
  InventoryItem,
  ShoppingItem,
  Event,
  BudgetCategory,
  Category,
  Expense,
} from "./models";
import type { Note } from "@features/notes";
import type { EventsListRangeResponse } from "@bindings/EventsListRangeResponse";

type ListOpts = {
  householdId: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
  includeHidden?: boolean;
};

const SEARCH_TABLES = new Set(["notes", "events", "vehicles", "pets"]);

// Generic repo factory with per-table default ordering
function domainRepo<T extends object>(table: string, defaultOrderBy: string) {
  return {
    async list(opts: ListOpts): Promise<T[]> {
      if (table === "events") {
        throw new Error(
          'Do not use domainRepo("events"). Use eventsApi.listRange(...) (events_list_range) instead.'
        );
      }
      const args: Record<string, unknown> = {
        householdId: opts.householdId,
        orderBy: opts.orderBy ?? defaultOrderBy,
        limit: opts.limit,
        offset: opts.offset,
      };

      if (table === "categories" && typeof opts.includeHidden === "boolean") {
        args.includeHidden = opts.includeHidden;
        // Some command bindings still rely on snake_case parameters; include both for safety.
        args.include_hidden = opts.includeHidden;
      }

      return await call<T[]>(`${table}_list`, args);
    },

    async create(householdId: string, data: Partial<T>): Promise<T> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      const out = await call<T>(`${table}_create`, {
        data: { ...data, household_id: householdId },
      });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
      return out;
    },

    async update(householdId: string, id: string, data: Partial<T>): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_update`, { id, data, householdId });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },

    async delete(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_delete`, { householdId, id });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },

    async restore(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_restore`, { householdId, id });
      // after successful write (post-await) by design
      if (SEARCH_TABLES.has(table)) clearSearchCache();
    },
  };
}

// ---- Normal repos ----
export const billsRepo            = domainRepo<Bill>("bills", "position, created_at, id");
export const policiesRepo         = domainRepo<Policy>("policies", "position, created_at, id");
export const propertyDocsRepo     = domainRepo<PropertyDocument>("property_documents", "position, created_at, id");
export const petsRepo             = domainRepo<Pet>("pets", "position, created_at, id");
export const petMedicalRepo       = domainRepo<PetMedicalRecord>("pet_medical", "date DESC, created_at DESC, id");
export const familyRepo           = domainRepo<FamilyMember>("family_members", "position, created_at, id");
export const inventoryRepo        = domainRepo<InventoryItem>("inventory_items", "position, created_at, id");
export const notesRepo            = domainRepo<Note>("notes", "position, created_at, id");
export const shoppingRepo         = domainRepo<ShoppingItem>("shopping_items", "position, created_at, id");

// ✅ Budget repos you need for BudgetView.ts
export const categoriesRepo        = domainRepo<Category>("categories", "position, created_at, id");
export const budgetCategoriesRepo = domainRepo<BudgetCategory>("budget_categories", "position, created_at, id");
export const expensesRepo         = domainRepo<Expense>("expenses", "date DESC, created_at DESC, id");

export const billsApi = {
  async dueBetween(
    householdId: string,
    fromMs: number,
    toMs: number,
    limit = 100,
    offset = 0
  ) {
    return await call<any[]>("bills_list_due_between", {
      householdId,
      fromMs,
      toMs,
      limit,
      offset,
    });
  },
};

// ---- Events: dedicated API (uses events_list_range and singular CRUD) ----
export const eventsApi = {
  async listRange(
    householdId: string,
    start = 0,
    end = Date.now() + 90 * 24 * 60 * 60 * 1000,
  ): Promise<EventsListRangeResponse> {
    console.log("events_list_range (repos.ts)", { householdId, start, end });
    return await call<EventsListRangeResponse>("events_list_range", {
      householdId,
      start,
      end,
    });
  },
  async create(householdId: string, data: Partial<Event>): Promise<Event> {
    const out = await call<Event>("event_create", { data: { ...data, household_id: householdId } });
    // after successful write (post-await) by design
    clearSearchCache();
    return out;
  },
  async update(householdId: string, id: string, data: Partial<Event>): Promise<void> {
    await call("event_update", { id, data, householdId });
    // after successful write (post-await) by design
    clearSearchCache();
  },
  async delete(householdId: string, id: string): Promise<void> {
    await call("event_delete", { householdId, id });
    // after successful write (post-await) by design
    clearSearchCache();
  },
  async restore(householdId: string, id: string): Promise<void> {
    await call("event_restore", { householdId, id });
    // after successful write (post-await) by design
    clearSearchCache();
  },
};
