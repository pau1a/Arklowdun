const DOMAIN_TABLES = [
  "household",
  "events",
  "bills",
  "policies",
  "property_documents",
  "inventory_items",
  "vehicles",
  "vehicle_maintenance",
  "pets",
  "pet_medical",
  "family_members",
  "budget_categories",
  "expenses",
] as const;

type DomainTable = (typeof DOMAIN_TABLES)[number];

const ORDER_MAP: Record<DomainTable, string> = {
  household: "created_at, id",
  events: "created_at, id",
  bills: "position, created_at, id",
  policies: "position, created_at, id",
  property_documents: "position, created_at, id",
  inventory_items: "position, created_at, id",
  vehicles: "position, created_at, id",
  vehicle_maintenance: "created_at, id",
  pets: "position, created_at, id",
  pet_medical: "created_at, id",
  family_members: "position, created_at, id",
  budget_categories: "position, created_at, id",
  expenses: "created_at, id",
};

const ALLOWED_ORDERS = new Set(Object.values(ORDER_MAP));

function ensureTable(table: string): void {
  if (!DOMAIN_TABLES.includes(table as any)) {
    throw new Error("invalid table");
  }
}

export interface ListOptions {
  householdId?: string;
  orderBy?: string; // must match one of ALLOWED_ORDERS
  limit?: number;
  offset?: number;
}

import type Database from "@tauri-apps/plugin-sql";
import { openDb } from "./open";

export async function listActive<T = any>(
  table: DomainTable,
  opts: ListOptions = {},
): Promise<T[]> {
  ensureTable(table);
  const db: Database = await openDb();
  const order =
    opts.orderBy && ALLOWED_ORDERS.has(opts.orderBy)
      ? opts.orderBy
      : ORDER_MAP[table];

  const scoped = table !== "household" && opts.householdId;
  const where = scoped
    ? `WHERE deleted_at IS NULL AND household_id = ?`
    : `WHERE deleted_at IS NULL`;

  const lim = Number.isFinite(opts.limit) ? ` LIMIT ${opts.limit}` : "";
  const off = Number.isFinite(opts.offset) ? ` OFFSET ${opts.offset}` : "";

  const sql = `SELECT * FROM ${table} ${where} ORDER BY ${order}${lim}${off}`;
  const params = scoped ? [opts.householdId] : [];
  return db.select<T[]>(sql, params);
}

export async function firstActive<T = any>(
  table: DomainTable,
  opts: Omit<ListOptions, "limit" | "offset"> = {},
) {
  const rows = await listActive<T>(table, { ...opts, limit: 1 });
  return rows[0];
}

export { DOMAIN_TABLES };
