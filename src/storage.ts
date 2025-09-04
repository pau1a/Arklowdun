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
  bills: "sqlite",
  policies: "sqlite",
  property_documents: "sqlite",
  vehicles: "sqlite",
  pets: "sqlite",
  family_members: "sqlite",
  inventory_items: "sqlite",
  notes: "sqlite",
  shopping_items: "sqlite",
  events: "sqlite",
};

export function assertJsonWritable(domain: keyof StorageFlags): void {
  if (storage[domain] !== "json") {
    throw new Error(`JSON write disabled for ${domain}`);
  }
}

export default storage;
