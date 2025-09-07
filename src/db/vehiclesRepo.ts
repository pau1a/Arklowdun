import { invoke } from "@tauri-apps/api/core";
import type { Vehicle } from "../bindings/Vehicle";

export const vehiclesRepo = {
  async list(householdId: string): Promise<Vehicle[]> {
    return invoke<Vehicle[]>("vehicles_list", { householdId });
  },
};
