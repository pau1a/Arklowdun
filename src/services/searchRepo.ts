// src/services/searchRepo.ts
import { call } from "../db/call";
import { defaultHouseholdId } from "../db/household";
import type { SearchResult } from "../bindings/SearchResult";

export async function search(
  query: string,
  limit = 100,
  offset = 0,
): Promise<SearchResult[]> {
  const householdId = await defaultHouseholdId();

  // Be tolerant to either Rust param name:
  // - Current/expected: household_id (snake_case)
  // - Some builds / older code: householdId (camelCase)
  const payload = {
    household_id: householdId,
    householdId, // backward/forward compatibility
    query,
    limit,
    offset,
  };

  if (import.meta.env.DEV) {
    console.debug("[search] invoking search_entities", payload);
  }

  return call<SearchResult[]>("search_entities", payload);
}

export type { SearchResult } from "../bindings/SearchResult";
