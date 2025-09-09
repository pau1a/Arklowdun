import { call } from "@tauri-apps/api/core";

export type SearchResult =
  | { kind: "File"; id: string; filename: string; updated_at: number }
  | {
      kind: "Event";
      id: string;
      title: string;
      start_at_utc: number;
      tz: string;
    }
  | {
      kind: "Note";
      id: string;
      snippet: string;
      updated_at: number;
      color: string;
    };

export async function search(
  query: string,
  limit = 100,
  offset = 0,
): Promise<SearchResult[]> {
  return call<SearchResult[]>("search_entities", { query, limit, offset });
}

