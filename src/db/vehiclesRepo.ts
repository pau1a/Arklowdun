import { call } from "@lib/ipc/call";
import type { Vehicle } from "../bindings/Vehicle";

type VehicleListCache = {
  householdId: string;
  vehicles: Vehicle[];
};

let listCache: VehicleListCache | null = null;

function normalizeInbound(vehicle: Vehicle): Vehicle {
  return {
    ...vehicle,
    next_mot_due:
      vehicle.next_mot_due && vehicle.next_mot_due > 0 ? vehicle.next_mot_due : undefined,
    next_service_due:
      vehicle.next_service_due && vehicle.next_service_due > 0
        ? vehicle.next_service_due
        : undefined,
  };
}

function cacheVehicles(householdId: string, vehicles: Vehicle[]): Vehicle[] {
  const snapshot = vehicles.map((vehicle) => ({ ...vehicle }));
  listCache = { householdId, vehicles: snapshot };
  return vehicles.map((vehicle) => ({ ...vehicle }));
}

function vehiclesFromCache(householdId: string): Vehicle[] | null {
  if (!listCache || listCache.householdId !== householdId) {
    return null;
  }
  return listCache.vehicles.map((vehicle) => ({ ...vehicle }));
}

function clearListCache(): void {
  listCache = null;
}

function normalizeRegistrationOutbound(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.replace(/\s+/g, " ").toUpperCase();
  }
  if (value === null) {
    return null;
  }
  return undefined;
}

function normalizeVinOutbound(value: unknown): string | null | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.toUpperCase();
  }
  if (value === null) {
    return null;
  }
  return undefined;
}

function normalizeOutbound(data: Partial<Vehicle>): Partial<Vehicle> {
  const next: Partial<Vehicle> = { ...data };
  if (Object.prototype.hasOwnProperty.call(next, "reg")) {
    const normalized = normalizeRegistrationOutbound(next.reg);
    if (normalized === undefined) {
      delete next.reg;
    } else {
      next.reg = normalized ?? null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(next, "vin")) {
    const normalized = normalizeVinOutbound(next.vin);
    if (normalized === undefined) {
      delete next.vin;
    } else {
      next.vin = normalized ?? null;
    }
  }
  return next;
}

async function fetchVehicles(householdId: string): Promise<Vehicle[]> {
  const rows = await call<Vehicle[]>("vehicles_list", { householdId });
  const normalized = rows.map(normalizeInbound);
  return cacheVehicles(householdId, normalized);
}

export const vehiclesRepo = {
  async list(householdId: string, options?: { refresh?: boolean }): Promise<Vehicle[]> {
    if (!options?.refresh) {
      const cached = vehiclesFromCache(householdId);
      if (cached) {
        return cached;
      }
    }
    return fetchVehicles(householdId);
  },

  async refresh(householdId: string): Promise<Vehicle[]> {
    return fetchVehicles(householdId);
  },

  async get(id: string, householdId: string): Promise<Vehicle | null> {
    const cached = vehiclesFromCache(householdId)?.find((vehicle) => vehicle.id === id);
    if (cached) {
      return { ...cached };
    }
    const row = await call<Vehicle | null>("vehicles_get", { householdId, id });
    return row ? normalizeInbound(row) : null;
  },

  async create(householdId: string, data: Partial<Vehicle>): Promise<Vehicle> {
    const outbound = normalizeOutbound({ ...data, household_id: householdId });
    const row = await call<Vehicle>("vehicles_create", {
      householdId,
      data: outbound,
    });
    clearListCache();
    return normalizeInbound(row);
  },

  async update(
    householdId: string,
    id: string,
    data: Partial<Vehicle>,
  ): Promise<Vehicle> {
    const outbound = normalizeOutbound(data);
    const row = await call<Vehicle>("vehicles_update", {
      householdId,
      id,
      data: outbound,
    });
    clearListCache();
    return normalizeInbound(row);
  },

  async delete(householdId: string, id: string): Promise<void> {
    await call("vehicles_delete", { householdId, id });
    clearListCache();
  },

  async restore(householdId: string, id: string): Promise<Vehicle> {
    const row = await call<Vehicle>("vehicles_restore", { householdId, id });
    clearListCache();
    return normalizeInbound(row);
  },
};

