# Store overview

The `src/store/` directory contains a tiny global store and the typed event bus
used by the Files, Calendar, and Notes views. The store is the single source of
truth for global UI state — views read from selectors and write through the
provided actions. Fetching remains in the view layer; store actions are pure and
synchronous.

## State slices

- **App frame (`app`)** – `activePane`, `isAppReady`, and a queue of user-facing
  errors (`errors`).
- **Files (`files`)** – read-only snapshot of the last directory scan
  (`items`, `path`, `ts`, optional `source`).
- **Events (`events`)** – cached calendar events with an optional window
  descriptor (`items`, `ts`, `window`, optional `source`).
- **Notes (`notes`)** – latest sticky-note snapshot (`items`, `ts`, optional
  `source`).

Each slice exposes selectors (see `selectors`) that return derived values.
Consumers should call `subscribe(selector, listener)` to react to changes and
must not hold onto the raw store object.

## Actions

`actions` exposes the minimal mutation surface:

- `setActivePane(pane)` – updates the current pane and marks the app ready.
- `pushError(error)` / `clearError(id)` – manage the global error queue.
- `files.updateSnapshot(snapshot)` – replace the files cache.
- `events.updateSnapshot(snapshot)` – replace the events cache.
- `notes.updateSnapshot(snapshot)` – replace the notes cache.

Actions return lightweight metadata (count/timestamp) so callers can publish the
matching event bus notification without re-counting.

All actions are synchronous and side-effect free — no IPC, timers, or async
operations belong in the store.

## Event bus

`src/store/events.ts` defines the typed publish/subscribe API. Channels are
limited to:

- `files:updated`
- `events:updated`
- `notes:updated`
- `household:changed`
- `error:raised`
- `app:ready`

Callers import `on/emit/off` from `src/store/events.ts`. Channel names and
payloads are fully typed; arbitrary string channels are not permitted. The legacy
`src/shared/events.ts` module re-exports the typed bus and is marked
`@deprecated` for gradual migration.

## Usage rules

- Do not perform IPC or async work inside store actions.
- Subscribe via selectors; avoid caching the root state object.
- When a view loads fresh data it should:
  1. call the appropriate `actions.*.updateSnapshot` method,
  2. publish the matching `*:updated` event using the metadata returned by the
     action.
- Clear subscriptions by calling the unsubscribe function when the view is
  torn down (see `src/utils/viewLifecycle.ts`).
