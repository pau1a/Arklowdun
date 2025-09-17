import Database from "@tauri-apps/plugin-sql";

export type SqlDatabase = Database;

export async function loadDatabase(connection: string): Promise<Database> {
  return Database.load(connection);
}

export { Database };
