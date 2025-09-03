export type StorageBackend = "sqlite" | "json";

export interface StorageFlags {
  bills: StorageBackend;
  policies: StorageBackend;
  property_documents: StorageBackend;
  vehicles: StorageBackend;
  pets: StorageBackend;
  family_members: StorageBackend;
  inventory_items: StorageBackend;
  notes: StorageBackend;
  shopping_items: StorageBackend;
  events: StorageBackend;
}

export const storage: StorageFlags = {
  bills: "json",
  policies: "json",
  property_documents: "json",
  vehicles: "json",
  pets: "json",
  family_members: "json",
  inventory_items: "json",
  notes: "json",
  shopping_items: "json",
  events: "json",
};

export function assertJsonWritable(domain: keyof StorageFlags): void {
  if (storage[domain] !== "json") {
    throw new Error(`JSON write disabled for ${domain}`);
  }
}

export default storage;
