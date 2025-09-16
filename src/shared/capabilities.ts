import { call } from "../api/call";
import { defaultHouseholdId } from "../db/household";
import { log } from "../utils/logger";

let caps: {
  files_index: boolean;
  vehicles_cols: boolean;
  pets_cols: boolean;
} | null = null;
let capsPromise: Promise<void> | null = null;
let capsTs = 0;
let capsLogged = false;

async function probe(): Promise<void> {
  const household_id = await defaultHouseholdId();
  const [files_index, vehicles_cols, pets_cols] = await Promise.all([
    call<boolean>("db_files_index_ready", { household_id }),
    call<boolean>("db_has_vehicle_columns"),
    call<boolean>("db_has_pet_columns"),
  ]);
  caps = { files_index, vehicles_cols, pets_cols };
  capsTs = Date.now();
  if (!capsLogged) {
    log.debug("caps:probe", { files_index, vehicles_cols, pets_cols });
    capsLogged = true;
  }
}

async function ensure(): Promise<void> {
  const stale = !caps || Date.now() - capsTs > 5 * 60_000;
  if (stale) {
    if (!capsPromise) {
      capsPromise = probe().finally(() => {
        capsPromise = null;
      });
    }
    await capsPromise;
  }
}

export async function probeCaps(): Promise<void> {
  await ensure();
}

export async function hasFilesIndex(): Promise<boolean> {
  await ensure();
  return caps!.files_index;
}

export async function hasVehicleColumns(): Promise<boolean> {
  await ensure();
  return caps!.vehicles_cols;
}

export async function hasPetColumns(): Promise<boolean> {
  await ensure();
  return caps!.pets_cols;
}

const tableCache = new Map<string, boolean>();

export async function tableExists(name: string): Promise<boolean> {
  if (tableCache.has(name)) return tableCache.get(name)!;
  const exists = await call<boolean>("db_table_exists", { name });
  tableCache.set(name, exists);
  return exists;
}
