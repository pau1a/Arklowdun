import { createCrudRepo, type NewRow, type PatchRow } from "../db/crudRepo";
import type {
  Bill,
  Policy,
  PropertyDocument,
  Vehicle,
  Pet,
  FamilyMember,
  InventoryItem,
  Note,
  ShoppingItem,
} from "../models";
import type { Event } from "../bindings/Event";

export const billsRepo = createCrudRepo<Bill, NewRow<Bill>, PatchRow<Bill>>("bills");
export const policiesRepo = createCrudRepo<Policy, NewRow<Policy>, PatchRow<Policy>>("policies");
export const propertyDocumentsRepo = createCrudRepo<
  PropertyDocument,
  NewRow<PropertyDocument>,
  PatchRow<PropertyDocument>
>("property_documents");
export const vehiclesRepo = createCrudRepo<Vehicle, NewRow<Vehicle>, PatchRow<Vehicle>>("vehicles");
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
export const notesRepo = createCrudRepo<Note, NewRow<Note>, PatchRow<Note>>("notes");
export const shoppingItemsRepo = createCrudRepo<
  ShoppingItem,
  NewRow<ShoppingItem>,
  PatchRow<ShoppingItem>
>("shopping_items");
export const eventsRepo = createCrudRepo<Event, NewRow<Event>, PatchRow<Event>>("events");
