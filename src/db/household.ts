import { call } from "../api/call";
import { log } from "../utils/logger";
import { emit } from "../store/events";

export async function defaultHouseholdId(): Promise<string> {
  try {
    return await call<string>("get_default_household_id");
  } catch (e) {
    log.warn("Household id lookup failed; using fallback", e);
    return "default";
  }
}

export function requireHousehold(householdId: string): string {
  if (!householdId) throw new Error("householdId required");
  return householdId;
}

export async function setDefaultHouseholdId(id: string): Promise<void> {
  await call("set_default_household_id", { id });
  emit("household:changed", { householdId: id });
}
