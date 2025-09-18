# PR-A — Eliminate IPC Leaks

## Purpose
Seal the architecture so that **UI and components never import or invoke IPC directly**.  
All IPC calls must live in dedicated adapters under `src/lib/ipc` or in the relevant feature’s `api/` layer.  
This enforces separation of concerns, simplifies testing, and keeps components presentation-only.

---

## Scope

**In:**
- Relocate direct IPC call sites currently in `src/ui/ImportModal.ts` and `src/main.ts`.
- Create or extend proper adapter functions in `src/lib/ipc` or `features/*/api`.
- Update callers (ImportModal, main bootstrap) to consume these adapters.

**Out:**
- No change to IPC signatures, payloads, or logic.
- No visual/UI differences.
- No refactor of unrelated features.

---

## Deliverables

1. **Inventory of leak points**
   - Confirm all current direct IPC imports under `src/ui/` and `src/main.ts`.
   - Document each file + line reference in the PR body before moving.

2. **Adapter layer**
   - For ImportModal: add a thin API wrapper (likely under `features/files/api/importApi.ts`) that delegates to `@lib/ipc/client`.
   - For main.ts: add a startup/boot adapter in `src/lib/ipc/startup.ts` (or equivalent) that provides the same effect but hides `@tauri-apps/api`.

3. **Updated call sites**
   - `ImportModal.ts` must consume the new feature API function.
   - `main.ts` must call through the new startup adapter.
   - All imports of `@tauri-apps/api/*` vanish from those files.

4. **Documentation**
   - In the PR body: a before→after table showing each moved call site (file + line → new adapter).

---

## Acceptance Criteria

- [ ] Repo-wide grep for `@tauri-apps/api` shows **zero matches** under:
  - `src/ui/**`
  - `src/**/components/**`
  - `src/main.ts`
- [ ] IPC imports appear only in:
  - `src/lib/ipc/**`
  - `features/*/api/**`
- [ ] App builds without warnings and functions identically (ZVD).
- [ ] PR body includes:
  - Leak point inventory (before list).
  - New adapter file locations.
  - Before→after mapping table.

---

## Evidence Ged must attach

- **Search output:** short paste of `grep` or `rg` showing zero IPC imports in forbidden paths.
- **Mapping table:** for example:

  | Old Location              | Line(s) | New Adapter Path                  | Notes             |
  |---------------------------|---------|-----------------------------------|-------------------|
  | `src/ui/ImportModal.ts`   | 14–22   | `features/files/api/importApi.ts` | Import workflow   |
  | `src/main.ts`             | 33–40   | `lib/ipc/startup.ts`              | App bootstrap     |

- **Smoke test result:** one screenshot or log excerpt showing ImportModal action still works and app still boots normally.

---

## Risks & Mitigations

- **Risk:** adapter signatures diverge from old usage.  
  *Mitigation:* define them as pass-through wrappers, no behavioural change.

- **Risk:** accidental new imports of `@tauri-apps/api` in components.  
  *Mitigation:* lint rule + CI check already in place (to be hardened in PR-E).

---

## Rollback Plan

- Restore IPC imports in `ImportModal.ts` and `main.ts` from the PR diff.
- Delete the newly created adapter files.
- Verify the app builds and functions as it did before.

---

## PR Checklist (to include in PR body)

- [ ] All identified leak points relocated to adapters.
- [ ] Repo scan confirms no direct IPC in UI/components/main.
- [ ] ZVD verified (no visual diffs, behaviour intact).
- [ ] Mapping table and search output attached.
- [ ] Rollback plan described.
```
