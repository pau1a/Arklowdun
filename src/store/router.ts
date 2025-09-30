export interface RouteParams {
  eventId: string | null;
  noteId: string | null;
}

const subscribers = new Set<(params: RouteParams) => void>();
let currentParams: RouteParams = { eventId: null, noteId: null };

function normaliseValue(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseRouteParams(hash: string | null | undefined): RouteParams {
  if (!hash) return { eventId: null, noteId: null };
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return { eventId: null, noteId: null };
  const query = hash.slice(queryIndex + 1);
  const search = new URLSearchParams(query);
  const eventId = normaliseValue(search.get("eventId"));
  const noteId = normaliseValue(search.get("noteId"));
  return { eventId, noteId };
}

export function setRouteParamsFromHash(hash: string | null | undefined): void {
  const next = parseRouteParams(hash);
  if (
    currentParams.eventId === next.eventId &&
    currentParams.noteId === next.noteId
  ) {
    return;
  }
  currentParams = next;
  subscribers.forEach((listener) => {
    try {
      listener({ ...currentParams });
    } catch (error) {
      console.error("router subscriber failed", error);
    }
  });
}

export function getRouteParams(): RouteParams {
  return { ...currentParams };
}

export function subscribeRouteParams(
  listener: (params: RouteParams) => void,
): () => void {
  subscribers.add(listener);
  listener({ ...currentParams });
  return () => {
    subscribers.delete(listener);
  };
}
