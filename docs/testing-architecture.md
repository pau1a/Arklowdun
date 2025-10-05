# Deterministic Testing Architecture

This document describes the contract-driven IPC layer, deterministic runtime primitives, and the way Arklowdun executes UI, accessibility, and integration tests without a live backend.

## Ports and Adapters

The IPC boundary is defined in [`src/lib/ipc/port.ts`](../src/lib/ipc/port.ts) and [`src/lib/ipc/contracts`](../src/lib/ipc/contracts/index.ts):

- Every IPC command has a Zod request/response schema.
- `TauriAdapter` wraps `window.__TAURI__.invoke`, validates payloads, and is used in production builds.
- `TestAdapter` is an in-memory implementation backed by fixtures and deterministic utilities. It exposes a small control surface on `window.__ARKLOWDUN_TEST_ADAPTER__` for debugging.
- `provider.ts` selects the adapter at runtime via `VITE_IPC_ADAPTER` (`tauri` | `fake`). Tests and local dev can override it programmatically.

### Adding a New IPC Command

1. Extend [`contracts/index.ts`](../src/lib/ipc/contracts/index.ts) with strict request/response schemas.
2. Add scenario handlers for deterministic fixtures under [`tests/scenarios`](../tests/scenarios).
3. Update the Rust command implementation if necessary and ensure both adapters are exercised by `tests/contracts/ipc-contracts.spec.ts`.

## Scenarios and Fixtures

Scenario files live in [`tests/scenarios`](../tests/scenarios) and are auto-registered through [`ScenarioLoader`](../src/lib/ipc/scenarioLoader.ts). Each scenario exports handlers keyed by IPC command name and can describe metadata such as initial database health.

Playwright tests select a scenario by setting `PLAYWRIGHT_SCENARIO`/`VITE_IPC_SCENARIO` before launch. (A lightweight `test.use({ scenario: '...' })` helper can wrap this environment toggle when suites adopt the shared fixtures.) The global setup freezes time, seeds deterministic randomness, and ensures the fake adapter is active.

Convenience script:

```bash
npm run dev:fake
```

launches Vite with the fake adapter and the default scenario so that the UI behaves like the Playwright runs.

## Deterministic Runtime

- [`FixedClock`](../src/lib/runtime/clock.ts) returns a pinned timestamp (`2024-06-01T12:00:00Z`).
- [`SeededRng`](../src/lib/runtime/rng.ts) provides repeatable pseudo-random values.
- `TestAdapter` consumes both to give stable IDs, timestamps, and screenshot baselines.

## Contract & Schema Tests

Two suites live in [`tests/contracts`](../tests/contracts):

- `ipc-contracts.spec.ts` asserts `TestAdapter` and `TauriAdapter` enforce the same payload contracts for critical commands.
- `schema-compat.spec.ts` exercises backward- and forward-compatible payloads so new optional fields do not break older clients.

Run them with:

```bash
npm run test:contracts
```

## Playwright and Accessibility Lanes

Playwright is configured in [`playwright.config.ts`](../playwright.config.ts) with a [global setup](../tests/e2e/global.setup.ts) that:

1. Forces `VITE_IPC_ADAPTER=fake`.
2. Chooses a scenario (`PLAYWRIGHT_SCENARIO` env or `defaultHousehold`).
3. Pins the timezone and deterministic clock.

CI lanes can toggle adapters via environment variables. Nightly parity runs can export `VITE_IPC_ADAPTER=tauri` to exercise a smaller slice against the live backend, while default CI runs (`scripts/ci`) execute all UI/a11y specs with the fake adapter for stability.

## Structured Logging

`TestAdapter` keeps a ring buffer of all IPC calls. When a Playwright test fails, you can run the following inside the browser console to dump the recent history:

```js
window.__ARKLOWDUN_TEST_ADAPTER__.dumpLogs();
```

This mirrors the data emitted in CI failure artifacts.

## Extending the System

When introducing a new field or command:

1. Update the shared schemas and regenerate any bindings.
2. Add deterministic fixture data in the relevant scenario so tests have predictable state.
3. Add regression coverage either in Playwright or node-based suites, leaning on the fake adapter whenever possible.
4. Update this document if the process or architecture changes.
