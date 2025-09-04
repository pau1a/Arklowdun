//import { invoke } from "@tauri-apps/api/core";
import { invoke } from "./debug";

import type {
  Bill,
  Policy,
  PropertyDocument,
  Vehicle,
  Pet,
  PetMedicalRecord,
  FamilyMember,
  InventoryItem,
  Note,
  ShoppingItem,
  Event,
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
      return await invoke<T[]>(`${table}_list`, {
        householdId: opts.householdId,
        orderBy: opts.orderBy ?? defaultOrderBy,
        limit: opts.limit,
        offset: opts.offset,
      });
    },

    async create(householdId: string, data: Partial<T>): Promise<T> {
      // Backend fills id/created_at/updated_at; caller can pass position where applicable
      return await invoke<T>(`${table}_create`, {
        data: { ...data, household_id: householdId },
      });
    },

    async update(householdId: string, id: string, data: Partial<T>): Promise<void> {
      await invoke(`${table}_update`, { id, data, householdId });
    },

    async delete(householdId: string, id: string): Promise<void> {
      await invoke(`${table}_delete`, { householdId, id });
    },

    async restore(householdId: string, id: string): Promise<void> {
      await invoke(`${table}_restore`, { householdId, id });
    },
  };
}

// Repos for all domains
export const billsRepo         = domainRepo<Bill>("bills", "position, created_at, id");
export const policiesRepo      = domainRepo<Policy>("policies", "position, created_at, id");
export const propertyDocsRepo  = domainRepo<PropertyDocument>("property_documents", "position, created_at, id");
export const vehiclesRepo      = domainRepo<Vehicle>("vehicles", "position, created_at, id");
export const petsRepo          = domainRepo<Pet>("pets", "position, created_at, id");
export const petMedicalRepo    = domainRepo<PetMedicalRecord>("pet_medical", "date DESC, created_at DESC, id");
export const familyRepo        = domainRepo<FamilyMember>("family_members", "position, created_at, id");
export const inventoryRepo     = domainRepo<InventoryItem>("inventory_items", "position, created_at, id");
export const notesRepo         = domainRepo<Note>("notes", "position, created_at, id");
export const shoppingRepo      = domainRepo<ShoppingItem>("shopping_items", "position, created_at, id");

// Events usually sort by start time rather than position
export const eventsRepo        = domainRepo<Event>("events", "starts_at, created_at, id");
