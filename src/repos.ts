// src/repos.ts
import { call } from "./db/call";

import type {
  Bill,
  Policy,
  PropertyDocument,
  Pet,
  PetMedicalRecord,
  FamilyMember,
  InventoryItem,
  Note,
  ShoppingItem,
  Event,
  BudgetCategory,
  Expense,
} from "./models";

type ListOpts = {
  householdId: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
};

// Generic repo factory with per-table default ordering
function domainRepo<T extends object>(table: string, defaultOrderBy: string) {
  return {
    async list(opts: ListOpts): Promise<T[]> {
      if (table === "events") {
        throw new Error(
          'Do not use domainRepo("events"). Use eventsApi.listRange(...) (events_list_range) instead.'
        );
      }
      return await call<T[]>(`${table}_list`, {
        householdId: opts.householdId,
        orderBy: opts.orderBy ?? defaultOrderBy,
        limit: opts.limit,
        offset: opts.offset,
      });
    },

    async create(householdId: string, data: Partial<T>): Promise<T> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      return await call<T>(`${table}_create`, {
        data: { ...data, household_id: householdId },
      });
    },

    async update(householdId: string, id: string, data: Partial<T>): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_update`, { id, data, householdId });
    },

    async delete(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_delete`, { householdId, id });
    },

    async restore(householdId: string, id: string): Promise<void> {
      if (table === "events") {
        throw new Error('Do not use domainRepo("events"). Use eventsApi.* helpers.');
      }
      await call(`${table}_restore`, { householdId, id });
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
  async listRange(householdId: string, start = 0, end = Number.MAX_SAFE_INTEGER): Promise<Event[]> {
    return await call<Event[]>("events_list_range", { householdId, start, end });
  },
  async create(householdId: string, data: Partial<Event>): Promise<Event> {
    return await call<Event>("event_create", { data: { ...data, household_id: householdId } });
  },
  async update(householdId: string, id: string, data: Partial<Event>): Promise<void> {
    await call("event_update", { id, data, householdId });
  },
  async delete(householdId: string, id: string): Promise<void> {
    await call("event_delete", { householdId, id });
  },
  async restore(householdId: string, id: string): Promise<void> {
    await call("event_restore", { householdId, id });
  },
};
