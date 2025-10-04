import { call } from "@lib/ipc/call";

interface HouseholdStatsRaw {
  id: string;
  name?: string | null;
  is_default?: boolean | number | null;
  counts?: Record<string, unknown> | null;
}

export interface HouseholdStatsEntry {
  id: string;
  name: string;
  isDefault: boolean;
  counts: Record<string, number>;
}

export function normaliseHouseholdStats(row: HouseholdStatsRaw): HouseholdStatsEntry {
  const name =
    typeof row.name === "string" && row.name.trim().length > 0 ? row.name : row.id;
  const isDefault = Boolean(row.is_default);
  const counts: Record<string, number> = {};
  if (row.counts && typeof row.counts === "object") {
    for (const [key, value] of Object.entries(row.counts)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        counts[key] = value;
      }
    }
  }
  return {
    id: row.id,
    name,
    isDefault,
    counts,
  };
}

export async function fetchHouseholdStats(): Promise<HouseholdStatsEntry[]> {
  const rows = await call<HouseholdStatsRaw[]>("diagnostics_household_stats");
  return rows.map(normaliseHouseholdStats);
}
