import { call } from "./call";
import type { Vehicle } from "../bindings/Vehicle";

function normalize(v: Vehicle): Vehicle {
  return {
    ...v,
    next_mot_due: v.next_mot_due && v.next_mot_due > 0 ? v.next_mot_due : undefined,
    next_service_due: v.next_service_due && v.next_service_due > 0 ? v.next_service_due : undefined,
  };
}

export const vehiclesRepo = {
  async list(householdId: string): Promise<Vehicle[]> {
    const rows = await call<Vehicle[]>("vehicles_list", { householdId });
    return rows.map(normalize);
  },

    async get(id: string, householdId: string): Promise<Vehicle | null> {
      const row = await call<Vehicle | null>("vehicles_get", { id, householdId });
      return row ? normalize(row) : null;
    },

  async create(householdId: string, data: Partial<Vehicle>): Promise<Vehicle> {
    const row = await call<Vehicle>("vehicles_create", {
      data: { ...data, household_id: householdId },
    });
    return normalize(row);
  },

  async update(householdId: string, id: string, data: Partial<Vehicle>): Promise<void> {
    await call("vehicles_update", { id, data, householdId });
  },

  async delete(householdId: string, id: string): Promise<void> {
    await call("vehicles_delete", { householdId, id });
  },

  async restore(householdId: string, id: string): Promise<void> {
    await call("vehicles_restore", { householdId, id });
  },
};

