import { openDb } from "./open";
import { requireHousehold } from "./household";
import { newUuidV7 } from "./id";
import { nowMs } from "./time";
import type { DomainTable } from "./repo";
import { ORDER_MAP } from "./repo";

export type RepoErrorCode =
  | "Constraint"
  | "NotFound"
  | "Tx"
  | "Parse"
  | "Io";

export class RepoError extends Error {
  constructor(public code: RepoErrorCode, message: string) {
    super(message);
  }
}

export interface CrudRepo<T, NewT, PatchT> {
  list(opts: {
    householdId: string;
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<T[]>;
  get(householdId: string, id: string): Promise<T | null>;
  create(householdId: string, input: NewT): Promise<T>;
  update(householdId: string, id: string, patch: PatchT): Promise<T>;
  delete(householdId: string, id: string): Promise<void>;
  restore(householdId: string, id: string): Promise<T>;
}

export type NewRow<T> = Omit<T, "id" | "created_at" | "updated_at" | "deleted_at">;
export type PatchRow<T> = Partial<NewRow<T>>;

export function createCrudRepo<
  T,
  NewT extends Record<string, any>,
  PatchT extends Record<string, any>,
>(table: DomainTable): CrudRepo<T, NewT, PatchT> {
  return {
    async list({ householdId, includeDeleted, limit, offset }) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      const order = ORDER_MAP[table];
      const where = includeDeleted
        ? "household_id = ?"
        : "deleted_at IS NULL AND household_id = ?";
      const lim = Number.isFinite(limit) ? ` LIMIT ${limit}` : "";
      const off = Number.isFinite(offset) ? ` OFFSET ${offset}` : "";
      const sql = `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order}${lim}${off}`;
      return db.select<T[]>(sql, [hh]);
    },
    async get(householdId, id) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      const rows = await db.select<T[]>(
        `SELECT * FROM ${table} WHERE id = ? AND household_id = ?`,
        [id, hh],
      );
      return rows[0] ?? null;
    },
    async create(householdId, input) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      const now = nowMs();
      const id = newUuidV7();
      const row: any = { id, household_id: hh, created_at: now, updated_at: now, ...input };
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(",");
      const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`;
      try {
        await db.execute(sql, Object.values(row));
      } catch (e: any) {
        if (/UNIQUE constraint failed/.test(String(e))) {
          throw new RepoError("Constraint", String(e));
        }
        throw new RepoError("Io", String(e));
      }
      return row as T;
    },
    async update(householdId, id, patch) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      const fields = { ...patch, updated_at: nowMs() } as Record<string, any>;
      const keys = Object.keys(fields);
      if (!keys.length) {
        const rows = await db.select<T[]>(
          `SELECT * FROM ${table} WHERE id = ? AND household_id = ?`,
          [id, hh],
        );
        const row = rows[0];
        if (!row) throw new RepoError("NotFound", "row not found");
        return row;
      }
      const set = keys.map((k) => `${k} = ?`).join(", ");
      const sql = `UPDATE ${table} SET ${set} WHERE id = ? AND household_id = ?`;
      try {
        await db.execute(sql, [...keys.map((k) => fields[k]), id, hh]);
      } catch (e: any) {
        if (/UNIQUE constraint failed/.test(String(e))) {
          throw new RepoError("Constraint", String(e));
        }
        throw new RepoError("Io", String(e));
      }
      const rows = await db.select<T[]>(
        `SELECT * FROM ${table} WHERE id = ? AND household_id = ?`,
        [id, hh],
      );
      const row = rows[0];
      if (!row) throw new RepoError("NotFound", "row not found");
      return row;
    },
    async delete(householdId, id) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      await db.execute(
        `UPDATE ${table} SET deleted_at = ? WHERE id = ? AND household_id = ?`,
        [nowMs(), id, hh],
      );
    },
    async restore(householdId, id) {
      const hh = requireHousehold(householdId);
      const db = await openDb();
      await db.execute(
        `UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND household_id = ?`,
        [id, hh],
      );
      const rows = await db.select<T[]>(
        `SELECT * FROM ${table} WHERE id = ? AND household_id = ?`,
        [id, hh],
      );
      const row = rows[0];
      if (!row) throw new RepoError("NotFound", "row not found");
      return row;
    },
  };
}
