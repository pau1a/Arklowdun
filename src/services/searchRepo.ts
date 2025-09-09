import { call } from "../db/call";
import { defaultHouseholdId } from "../db/household";
import type { SearchResult } from "../bindings/SearchResult";

export async function search(
  query: string,
  limit = 100,
  offset = 0,
): Promise<SearchResult[]> {
  const householdId = await defaultHouseholdId();
  return call<SearchResult[]>("search_entities", {
    household_id: householdId,
    query,
    limit,
    offset,
  });
}

export type { SearchResult } from "../bindings/SearchResult";
