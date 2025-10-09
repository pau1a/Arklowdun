# Family member drawer

The Family drawer surfaces the full member profile (personal, finance, audit tabs) and persists edits through
`familyStore.upsert`. The drawer is mounted by `createFamilyDrawer` in `src/features/family/FamilyDrawer/index.ts` and is
available whenever `ENABLE_FAMILY_EXPANSION` is true.

## Persistence guardrails

- The drawer computes a diff before calling `saveMember`. If no fields change, the Save button is disabled, an info toast reads
  “No changes to save.”, and no IPC traffic is emitted.
- `familyStore.upsert` logs a `[family.upsert.noop]` console warning and a `ui.family.upsert.noop` telemetry event when it
  receives an empty patch. The call returns the current snapshot without touching the backend.
- The shared domain repository now short-circuits empty payloads and logs `repo.update.noop`, ensuring no table (family or
  otherwise) can send a `null`/empty patch to `${table}_update`.
- When changes are present, `familyRepo.update` receives only mutated fields (nested finance, phone, and social links are
  pruned if unchanged) so the backend observes a minimal patch.

## User experience

- Save remains disabled until the user edits a field; typing or toggling inputs marks the drawer as dirty and re-enables the
  action.
- Attempting to Save with no changes shows an info toast instead of an error.
- Cancelling or completing a save restores the disabled state until the next edit.

## Testing notes

Automated coverage lives in `tests/family/drawerNoopUpdate.test.ts`, which hydrates the store, performs a no-op Save, and asserts
that `familyRepo.update` is never called. This regression test guards against future routes that might accidentally emit empty
payloads.
