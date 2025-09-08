import { call } from "./call.ts";

export async function deleteHousehold(id: string): Promise<void> {
  await call("household_delete", { householdId: id, id });
}

export async function restoreHousehold(id: string): Promise<void> {
  await call("household_restore", { householdId: id, id });
}
