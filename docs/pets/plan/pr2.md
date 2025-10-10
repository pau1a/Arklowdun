# Pets PR2 – IPC Contract Validation

### Objective

PR2 verifies and hardens the **Inter-Process Communication (IPC) contract** between the TypeScript renderer and the Rust backend for all Pets-related commands.
It guarantees that payload shapes, error codes, and data return formats for `pets_*` and `pet_medical_*` endpoints are stable, typed, and traceable before further work proceeds.

---

## 1. Scope & Intent

PR2 does **not** introduce new user-visible behaviour.
It establishes *confidence and immutability* in the IPC layer by:

* Ensuring every command invoked from the UI (`petsRepo`, `petMedicalRepo`) is registered, reachable, and responds successfully.
* Defining or validating Zod schemas for each command’s request/response.
* Normalising all error codes into the structured `AppError` object.
* Documenting endpoint definitions in `docs/pets/ipc.md`.
* Updating test harnesses to exercise CRUD round-trips end-to-end through Tauri IPC.

---

## 2. Commands in scope

| IPC Command          | Description                             | Backend Handler                                   |
| -------------------- | --------------------------------------- | ------------------------------------------------- |
| `pets_list`          | List all pets for the active household. | `pets_list_active` in `src-tauri/src/commands.rs` |
| `pets_create`        | Create a new pet record.                | `pets_insert`                                     |
| `pets_update`        | Update a pet’s attributes.              | `pets_update`                                     |
| `pets_delete`        | Soft-delete a pet.                      | `pets_soft_delete`                                |
| `pet_medical_list`   | List medical records for a given pet.   | `pet_medical_list_active`                         |
| `pet_medical_create` | Add a new medical record.               | `pet_medical_insert`                              |
| `pet_medical_delete` | Delete a medical record.                | `pet_medical_delete`                              |

No additional endpoints (such as `pets_restore`) are implemented at this stage; only the core CRUD path is validated.

---

## 3. Deliverables

| Deliverable                     | Description                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------- |
| **IPC reachability test suite** | Confirms all 7 commands respond with HTTP-style 200 equivalents.              |
| **Zod schema definitions**      | Request and response types formalised in `src/lib/ipc/contracts/pets.ts`.     |
| **TypeScript repo alignment**   | `petsRepo` and `petMedicalRepo` updated to use strongly typed contract calls. |
| **Error mapping registry**      | Each backend error code maps cleanly to frontend copy via `normalizeError()`. |
| **Documentation update**        | `docs/pets/ipc.md` rewritten with full payload examples and error table.      |

---

## 4. Detailed tasks

### 4.1 Enumerate contracts

Run the contract sync test:

```bash
npm run test:contracts -- tests/contracts/ipc-command-sync.spec.ts
```

The script compares the generated Tauri handler list to the frontend contract map and fails if
any Pets command is missing on either side.

### 4.2 Validate Zod schemas

In `src/lib/ipc/contracts/pets.ts`:

```ts
export const PetsListRequest = z.object({
  householdId: z.string(),
  includeDeleted: z.boolean().optional(),
});

export const PetsListResponse = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    position: z.number(),
    deleted_at: z.string().nullable(),
  })
);
```

Each request and response object must validate cleanly under `zod` test harness.

### 4.3 Normalise error codes

Map backend error variants to human-readable UI copy in `src/lib/ipc/call.ts`:

| Rust code           | UI message                          |
| ------------------- | ----------------------------------- |
| `INVALID_HOUSEHOLD` | “No active household selected.”     |
| `SQLX/UNIQUE`       | “Duplicate entry detected.”         |
| `SQLX/NOTNULL`      | “Required field missing.”           |
| `APP/UNKNOWN`       | “Unexpected error occurred.”        |
| `PATH_OUT_OF_VAULT` | “File path outside vault boundary.” |

Verify that thrown errors display the correct toast message in the console log or UI output.

### 4.4 Round-trip test

Implement automated loop:

```bash
npm run test:ipc:pets
```

Each step performs:

1. Create → List → Update → Delete pet.
2. Create → List → Delete pet_medical record.
3. Ensure all CRUD operations return structured JSON responses (`success`, `data`, `error` fields).
4. Validate cascade consistency after deletion.

### 4.5 Trace validation

Enable structured logs:

```
RUST_LOG=trace npm run tauri dev
```

Expected entries:

```
[trace] ipc.dispatch { name="pets_create", duration_ms=12 }
[trace] ipc.result { name="pets_list", rows=5 }
```

Absence of logs indicates unregistered or silently failing commands.

### 4.6 Schema synchronisation test

Compare the TypeScript schema fields to the SQL schema via autogenerated diff tool:

```bash
npm run check:schema pets
```

Report any mismatches (extra or missing fields) to `/docs/pets/database.md` under *Schema quirks*.

---

## 5. Acceptance checklist

| Condition                                                           | Status | Evidence |
| ------------------------------------------------------------------- | ------ | -------- |
| All Pets IPC commands registered and callable                       | ☑      | `tests/contracts/pets-ipc.spec.ts` |
| Commands return JSON data with valid shape                          | ☑      | `npm run test:ipc:pets` |
| Zod schemas validate both request and response payloads             | ☑      | `src/lib/ipc/contracts/pets.ts` |
| All backend error codes mapped in UI                                | ☑      | `src/lib/ipc/call.ts` |
| Structured logging produces `ipc.dispatch` and `ipc.result` entries | ☑      | `src/lib/ipc/adapters/tauri.ts` |
| Docs updated (`ipc.md`, `plan/checklist.md`)                        | ☑      | `docs/pets/ipc.md` |
| CI integration tests pass on macOS                                  | ☐      | Runs post-merge in CI pipeline |

---

## 6. Verification workflow

1. Start app in dev mode with tracing:

   ```bash
   RUST_LOG=trace npm run tauri dev
   ```
2. Open the Pets pane manually or via `Cmd + K` → *Pets*.
3. Create a new pet (“TestDog”) → observe log line `[ipc.result name="pets_create"]`.
4. Run automated IPC test suite:

   ```bash
   npm run test:ipc:pets
   ```
5. Verify that both `pets` and `pet_medical` commands return arrays or objects with valid shape.
6. Examine error responses by intentionally inserting bad payloads (missing householdId).
7. Confirm errors are displayed in user-friendly copy.

---

## 7. Risks & mitigations

| Risk                                         | Mitigation                                                |
| -------------------------------------------- | --------------------------------------------------------- |
| Missing contract causes runtime failure      | Coverage script ensures all names enumerated.             |
| Schema drift between Rust and TypeScript     | Automated diff tool (`check:schema`) flags discrepancies. |
| Legacy `flexibleRequest` bypasses validation | Removed once Zod validation active.                       |
| Backend panic on malformed JSON              | Wrapped with `dispatch_async_app_result` safety net.      |

---

## 8. Documentation updates required

| File                          | Update                                       |
| ----------------------------- | -------------------------------------------- |
| `docs/pets/ipc.md`            | Full request/response examples, error table. |
| `docs/pets/database.md`       | Add verified SQL→IPC field mapping table.    |
| `docs/pets/plan/checklist.md` | Tick PR2 entries once complete.              |
| `CHANGELOG.md`                | Add “PR2 – Pets IPC contracts validated.”    |

---

## 9. Out-of-scope items

* UI rendering, reminder logic, or UX feedback.
* Attachment open/reveal testing (handled in PR6).
* Diagnostics counter integration (handled in PR8).
* Schema modification — PR2 validates, does not alter.

---

## 10. Sign-off

| Role          | Name              | Responsibility                            |
| ------------- | ----------------- | ----------------------------------------- |
| **Developer** | Ged McSneggle     | Implements IPC validation and test suite. |
| **Reviewer**  | Paula Livingstone | Confirms schema parity and error mapping. |
| **QA/CI**     | Automated         | Executes integration suite under macOS.   |

---

**Status:** Ready for execution
**File:** `/docs/pets/plan/pr2.md`
**Version:** 1.0
**Scope:** Establishes verified, typed, and traceable IPC contracts for the Pets domain — prerequisite for PR3 and beyond.

---
