import { invoke } from "@tauri-apps/api/core";

export async function deleteHousehold(id: string): Promise<void> {
  await invoke("household_delete", { householdId: id, id });
}

export async function restoreHousehold(id: string): Promise<void> {
  await invoke("household_restore", { householdId: id, id });
}
