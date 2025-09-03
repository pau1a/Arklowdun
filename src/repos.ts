import { invoke } from "@tauri-apps/api/core";
import type { Bill, Policy } from "./models";

type ListOpts = {
  householdId: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
};

function domainRepo<T extends object>(table: string) {
  return {
    async list(opts: ListOpts): Promise<T[]> {
      return await invoke<T[]>(`${table}_list`, {
        householdId: opts.householdId,
        orderBy: opts.orderBy ?? "position, created_at, id",
        limit: opts.limit,
        offset: opts.offset,
      });
    },
    async create(householdId: string, data: Partial<T>): Promise<T> {
      // Back-end fills id/created_at/updated_at; caller provides position if desired
      return await invoke<T>(`${table}_create`, {
        data: { ...data, household_id: householdId },
      });
    },
    async update(householdId: string, id: string, data: Partial<T>): Promise<void> {
      await invoke(`${table}_update`, { id, data, householdId });
    },
    async delete(householdId: string, id: string): Promise<void> {
      await invoke(`${table}_delete`, { householdId, id });
    },
    async restore(householdId: string, id: string): Promise<void> {
      await invoke(`${table}_restore`, { householdId, id });
    },
  };
}

export const billsRepo = domainRepo<Bill>("bills");
export const policiesRepo = domainRepo<Policy>("policies");
