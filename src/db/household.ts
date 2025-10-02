import { log } from "../utils/logger";
import { ensureActiveHousehold, forceSetActiveHousehold } from "../state/householdStore";

export async function defaultHouseholdId(): Promise<string> {
  try {
    return await ensureActiveHousehold();
  } catch (e) {
    log.warn("Household id lookup failed; using fallback", e);
    return "default";
  }
}

export async function getHouseholdIdForCalls(): Promise<string> {
  return ensureActiveHousehold();
}

export function requireHousehold(householdId: string): string {
  if (!householdId) throw new Error("householdId required");
  return householdId;
}

export async function setDefaultHouseholdId(id: string): Promise<void> {
  const result = await forceSetActiveHousehold(id);
  if (!result.ok) {
    throw new Error(result.code);
  }
}
