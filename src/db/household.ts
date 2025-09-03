import { invoke } from "@tauri-apps/api/core";

export async function defaultHouseholdId(): Promise<string> {
  try {
    return await invoke<string>("get_default_household_id");
  } catch (e) {
    console.warn("Household id lookup failed; using fallback", e);
    return "default";
  }
}

export function requireHousehold(householdId: string): string {
  if (!householdId) throw new Error("householdId required");
  return householdId;
}
