import { call } from "../db/call";
import { defaultHouseholdId } from "../db/household";
import type { SearchResult } from "../bindings/SearchResult";
import { log } from "../utils/logger";
import { on } from "../shared/events";
import { probeCaps } from "../shared/capabilities";

probeCaps().catch(() => {});

const CACHE_TTL_MS = 30_000;
const CACHE_VERSION = 1;

type CacheEntry =
  | { promise: Promise<SearchResult[]>; tsStart: number }
  | { results: SearchResult[]; ts: number };

const cache = new Map<string, CacheEntry>();
const loggedHits = new Set<string>();
const loggedMisses = new Set<string>();

function stableKey(obj: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .map((k) => [k, (obj as any)[k]])
  );
}

function bust() {
  cache.clear();
  loggedHits.clear();
  loggedMisses.clear();
}

on("householdChanged", bust);
on("searchInvalidated", bust);

export async function search(
  query: string,
  limit = 100,
  offset = 0,
): Promise<SearchResult[]> {
  const householdId = await defaultHouseholdId();
  const key = stableKey({ v: CACHE_VERSION, q: query, offset, limit, householdId });
  const now = Date.now();
  const existing = cache.get(key);
  if (existing) {
    if ("promise" in existing) {
      if (!loggedHits.has(key)) {
        log.debug("search:cache", { key, hit: true, age_ms: 0 });
        loggedHits.add(key);
      }
      return existing.promise;
    }
    const age = now - existing.ts;
    if (age < CACHE_TTL_MS) {
      if (!loggedHits.has(key)) {
        log.debug("search:cache", { key, hit: true, age_ms: age });
        loggedHits.add(key);
      }
      return existing.results;
    }
    cache.delete(key);
    loggedHits.delete(key);
    loggedMisses.delete(key);
  }

  const promise = call<unknown>("search_entities", {
    householdId,
    query,
    limit,
    offset,
  }).then((payload) => {
    if (!Array.isArray(payload)) {
      log.debug("[search] IPC non-array", payload);
      return [] as SearchResult[];
    }
    return payload as SearchResult[];
  });

  cache.set(key, { promise, tsStart: now });

  try {
    const results = await promise;
    cache.set(key, { results, ts: Date.now() });
    if (!loggedMisses.has(key)) {
      log.debug("search:cache", { key, hit: false });
      loggedMisses.add(key);
    }
    return results;
  } catch (err) {
    cache.delete(key);
    loggedHits.delete(key);
    loggedMisses.delete(key);
    throw err;
  }
}

export function clearSearchCache() {
  bust();
}

export type { SearchResult } from "../bindings/SearchResult";
