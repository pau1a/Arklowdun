import { call } from "../db/call";
import { defaultHouseholdId } from "../db/household";
import type { SearchResult } from "../bindings/SearchResult";
import { log } from "../utils/logger";

export async function search(
  query: string,
  limit = 100,
  offset = 0,
): Promise<SearchResult[]> {
  const household_id = await defaultHouseholdId();
  const payload = await call<unknown>("search_entities", {
    household_id,
    query,
    limit,
    offset,
  });
  if (!Array.isArray(payload)) {
    log.debug("[search] IPC non-array", payload);
    return [];
  }
  return payload as SearchResult[];
}

export type { SearchResult } from "../bindings/SearchResult";
