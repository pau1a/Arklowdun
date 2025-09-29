import { createCrudRepo, type NewRow, type PatchRow } from "../db/crudRepo";
import type {
  Bill,
  Policy,
  PropertyDocument,
  Pet,
  FamilyMember,
  InventoryItem,
  ShoppingItem,
} from "../models";
import type { Event } from "../bindings/Event";
import { notesRepo as typedNotesRepo } from "./notesRepo";

export const billsRepo = createCrudRepo<Bill, NewRow<Bill>, PatchRow<Bill>>("bills");
export const policiesRepo = createCrudRepo<Policy, NewRow<Policy>, PatchRow<Policy>>("policies");
export const propertyDocumentsRepo = createCrudRepo<
  PropertyDocument,
  NewRow<PropertyDocument>,
  PatchRow<PropertyDocument>
>("property_documents");
export const petsRepo = createCrudRepo<Pet, NewRow<Pet>, PatchRow<Pet>>("pets");
export const familyMembersRepo = createCrudRepo<
  FamilyMember,
  NewRow<FamilyMember>,
  PatchRow<FamilyMember>
>("family_members");
export const inventoryItemsRepo = createCrudRepo<
  InventoryItem,
  NewRow<InventoryItem>,
  PatchRow<InventoryItem>
>("inventory_items");
export const notesRepo = typedNotesRepo;
export const shoppingItemsRepo = createCrudRepo<
  ShoppingItem,
  NewRow<ShoppingItem>,
  PatchRow<ShoppingItem>
>("shopping_items");
export const eventsRepo = createCrudRepo<Event, NewRow<Event>, PatchRow<Event>>("events");
