import { invoke } from "@tauri-apps/api/core";

export async function deleteHousehold(id: string): Promise<string | null> {
  return await invoke("delete_household_cmd", { id });
}

export async function restoreHousehold(id: string): Promise<void> {
  await invoke("restore_household_cmd", { id });
}
