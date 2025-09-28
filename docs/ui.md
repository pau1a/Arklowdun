# Ambient Background System

The ambient background provides a lightweight, canvas-based blob animation that runs behind the dashboard and other views. It ships with two power-aware renderers and a deterministic rotation system so every install receives a stable weekly look unless the user chooses otherwise.

## Components

### `SoloBlobEco`

`src/components/SoloBlobEco.tsx` exports a `SoloBlobEco` class that manages a single canvas element. Key features:

- Caps rendering scale to ≤ 0.75 × DPR (and never above 1 × DPR).
- Uses pre-rendered radial sprites to avoid per-frame allocations.
- Drops from 20 fps to 8 fps after 10 s of inactivity and pauses when the document is hidden or reduced-motion is requested.
- Supports primary and secondary tones (`teal`, `aqua`, `teal2`, `coral`, `shade`).

Constructor signature:

```ts
const renderer = new SoloBlobEco(hostElement, {
  seed,              // number used to seed the pseudo RNG
  mode: "teal",      // primary blob tone (default teal)
  secondMode: "aqua",// optional secondary tone
  activeFps: 20,
  idleFps: 8,
  idleMs: 10_000,
  renderScale: 0.75,
  edgeBias: 0.75,
  zIndex?: number,
  paused?: boolean,
});
```

Call `renderer.setSeed(nextSeed)` to rebuild the animation deterministically or `renderer.setModes(primary, secondary)` to swap tones. `renderer.renderOnce()` renders a static frame for reduced-motion scenarios. Always call `renderer.destroy()` when removing the host.

Prefer the helper `mountSoloBlobEco(host, options)` where possible – it wraps construction with defensive logging and returns the renderer instance.

### `BlobFieldEco`

`src/components/BlobFieldEco.tsx` builds on the same base class and renders a light multi-blob field. Options include:

```ts
const field = new BlobFieldEco(host, {
  seed,
  count: 10,
  maxFps: 30,
  idleFps: 12,
  idleMs: 12_000,
  renderScale: 0.7,
  edgeBias: 0.55,
});
```

`setCount(n)` and `setPalette([tone, …])` reconfigure the field at runtime. Like the solo renderer, call `destroy()` when cleaning up.

Use `mountBlobFieldEco(host, options)` to create the field with the same convenience and logging guarantees as the solo helper.

Both renderers respect `prefers-reduced-motion` and pause automatically when the document is hidden or the Tauri window blurs.

## Rotation & Persistence

The rotation helpers in `src/lib/blobRotation.ts` provide deterministic seeds derived from the install ID and the current ISO week (Europe/London) or month:

- `getBlobSeedForPeriod(mode)` returns the seed for the requested cadence and persists `blobSeed`, `blobWeekKey`, and `blobLastGeneratedAt` in `window-state.json` (via `tauri-plugin-store`).
- `forceNewBlobUniverse()` generates a fresh seed inside the current period and broadcasts it to listeners.
- Utility exports `formatIsoWeekKey`, `formatLondonMonthKey`, and `fnv1a32` support testing and diagnostics.

`src/lib/store.ts` wraps `tauri-plugin-store` with in-memory fallbacks so tests and non-Tauri environments never throw if storage is unavailable. It exposes `getAmbientMode`, `setAmbientMode`, `getRotationMode`, and change listeners used by the UI and background controller.

## Ambient Background Controller

`src/ui/AmbientBackground.ts` initialises the background once the layout mounts. It listens for:

- Ambient mode changes (`Off`, `Eco`, `Full`).
- Rotation cadence changes (`Off`, `Weekly`, `Monthly`).
- Seed updates from the rotation helpers and the “Refresh now” action.
- `tauri://focus` and `tauri://blur` events to resume/pause rendering when the window gains or loses focus.

The controller mounts `SoloBlobEco` for Eco/Off modes (rendering a static frame when motion is disabled) and `BlobFieldEco` for Full mode. It tears down cleanly on unload.

## Settings UI

`src/features/settings/components/AmbientBackgroundSection.ts` adds a dedicated card under Settings → Appearance with:

- Radio buttons to toggle Ambient background (Off / Eco / Full).
- Rotation cadence options (Off / Weekly / Monthly).
- A “Refresh now” button that calls `forceNewBlobUniverse()`.
- Status messaging for persistence/refresh feedback.

All controls persist through `tauri-plugin-store` and apply immediately to the background controller.

## Troubleshooting

- **No motion:** Verify `prefers-reduced-motion` and the user’s Ambient mode (Off renders a static frame). The controller logs to `log.debug` when initialising or changing mode.
- **Seeds not rotating:** Ensure `blobRotation` is set to Weekly or Monthly. For diagnostics, inspect `window-state.json` (`blobWeekKey`, `blobLastGeneratedAt`).
- **High CPU usage:** Confirm render scale (`renderScale` prop) ≤ 0.75 and blob counts within the documented budgets (≤ 2 for Solo, ≤ 12 for Field). The renderers automatically drop to idle fps when inactive.
- **Storage failures:** The store wrapper falls back to volatile memory; seeds still generate deterministically for the session but won’t persist between launches.
