# Pets IPC & Validation

### Purpose

This document defines the inter-process communication (IPC) layer for the Pets domain.
It describes the commands exposed to the front end, their request/response payloads, validation rules, and the error taxonomy used by the Arklowdun runtime.
All Pets IPC endpoints operate through Tauri’s command interface and share the same structured-error, household-scoping, and asynchronous dispatch patterns as the Family, Vehicles, and Bills domains.

---

## 1. Command inventory

The following commands are registered in `src-tauri/src/lib.rs` via the `gen_domain_cmds!` macro:

| Category      | Command               | Purpose                                                                           |
| ------------- | --------------------- | --------------------------------------------------------------------------------- |
| Pets          | `pets_list`           | List all pets for the active household, ordered by `position, created_at, id`.   |
|               | `pets_get`            | Retrieve a single pet by ID.                                                      |
|               | `pets_create`         | Insert a new pet record.                                                          |
|               | `pets_update`         | Patch one or more mutable fields.                                                 |
|               | `pets_delete`         | Soft-delete a pet (sets `deleted_at`).                                            |
|               | `pets_reorder`        | Persist a new ordering list (position updates).                                   |
| Pet Medical   | `pet_medical_list`    | List all medical records for a pet.                                               |
|               | `pet_medical_create`  | Create a new dated medical entry.                                                 |
|               | `pet_medical_update`  | Modify description, diagnosis, dosage, or reminder timestamp.                     |
|               | `pet_medical_delete`  | Delete a medical record.                                                          |
| Maintenance   | `household_vacuum`    | Optional vacuum and integrity check—shared command, also touches Pets tables.     |

All commands are synchronous from the caller’s perspective (awaited Promises) but execute asynchronously inside the Rust runtime using Tokio.

---

## 2. Request and response shapes

The contracts use the `flexibleRequest` pattern: key/value payloads validated by Zod on the TypeScript side and serialised into JSON before invoking the Rust command.

### 2.1 `pets_list`
```jsonc
// Request
{
  "household_id": "uuid-string"
}

// Response
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "household_id": "uuid",
      "name": "Skye",
      "type": "Dog",
      "breed": "Husky",
      "position": 0,
      "created_at": "2025-10-10T08:55:12Z",
      "updated_at": "2025-10-10T08:55:12Z"
    }
  ]
}
```

### 2.2 `pets_create`
```jsonc
// Request
{
  "household_id": "uuid",
  "name": "Whiskey",
  "type": "Dog",
  "breed": "Labrador",
  "sex": "Female",
  "neutered": true
}

// Response
{
  "ok": true,
  "data": {
    "id": "uuid",
    "household_id": "uuid",
    "created_at": "2025-10-10T08:57:31Z"
  }
}
```

### 2.3 `pet_medical_create`
```jsonc
// Request
{
  "household_id": "uuid",
  "pet_id": "uuid",
  "date": "2025-09-01",
  "description": "Vaccination booster",
  "reminder_at": "2026-09-01T09:00:00Z",
  "root_key": "appdata",
  "relative_path": "attachments/pets/booster2025.pdf"
}

// Response
{
  "ok": true,
  "data": {
    "id": "uuid",
    "category": "pet_medical",
    "created_at": "2025-10-10T08:58:12Z"
  }
}
```

All commands return a standard envelope:

```jsonc
{
  "ok": boolean,
  "data"?: object | array,
  "error"?: {
    "code": "string",
    "message": "string",
    "context"?: object,
    "crash_id"?: "uuid"
  }
}
```

---

## 3. Validation pipeline

### 3.1 TypeScript layer

Each IPC helper imports Zod schemas from `src/shared/ipc/contracts/index.ts`.
Required fields are verified before invoking `invoke(command, payload)`.
Payload keys accept either `snake_case` or `camelCase`; helpers normalise them to `snake_case` for Rust.

```ts
const schema = z.object({
  household_id: z.string().uuid(),
  pet_id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  type: z.string().max(64).optional(),
});
```

### 3.2 Rust layer

Rust handlers perform second-level validation:

* **Household scope check:** verifies `household_id` exists and matches the active store.
* **Foreign-key check:** for `pet_medical_*`, confirms `pet_id` belongs to the same household.
* **String sanitisation:** trims whitespace, rejects overlong fields (>512 chars).
* **Attachment guard:** validates vault paths via `Vault::resolve`.
* **Constraint enforcement:** prevents duplicate microchip values.
* **Error wrapping:** violations return structured `AppError` with code and message.

---

## 4. Household scoping and permission model

* Every IPC request must carry `household_id`.
* Commands fail fast with `HOUSEHOLD_NOT_FOUND` if the ID is absent or invalid.
* Scoping is enforced in SQL through `WHERE household_id = ?`; no unscoped reads occur.
* The same scoping applies to `pet_medical` operations: the FK ensures all rows belong to the same household as the parent pet.
* The backend does not rely on the front end’s notion of “active household” alone; it verifies household ownership on every call.

---

## 5. Error taxonomy

| Code                      | Source             | Description                                           |
| ------------------------- | ------------------ | ----------------------------------------------------- |
| `VALIDATION_ERROR`        | Front end / Zod    | Required field missing, type mismatch.                |
| `HOUSEHOLD_NOT_FOUND`     | Rust               | `household_id` absent or not registered.              |
| `FOREIGN_KEY_VIOLATION`   | SQLX               | `pet_id` or `household_id` mismatch.                  |
| `ATTACHMENT_OUT_OF_VAULT` | Vault              | Relative path outside allowed roots.                  |
| `PATH_SYMLINK_REJECTED`   | Vault              | Symlink detected in attachment path.                  |
| `NAME_TOO_LONG`           | Vault              | File or folder name exceeds policy length.            |
| `UNIQUE_CONSTRAINT_FAILED`| SQLX               | Duplicate microchip or attachment path.               |
| `DB_UNHEALTHY_WRITE_BLOCKED` | Storage health | Mutation attempted while DB unhealthy.                |
| `UNKNOWN_ERROR`           | Catch-all          | Any uncategorised runtime exception.                  |

All errors are serialised into the envelope’s `error` object and mirrored in structured JSON logs with a crash ID when applicable.

---

## 6. Logging and tracing

Each IPC handler emits tracing events via the shared `tracing::info!` and `tracing::error!` macros.
Log fields include:

* `cmd` – the command name (`pets_create`, etc.).
* `household` – active household UUID.
* `duration_ms` – command execution time.
* `rows_affected` – number of modified rows.
* `status` – "ok" or "err".
* `error_code` – present on failure.

Example log entry:

```jsonc
{
  "ts": "2025-10-10T08:59:00Z",
  "cmd": "pet_medical_create",
  "household": "f9c2...f71",
  "rows_affected": 1,
  "status": "ok",
  "duration_ms": 4
}
```

---

## 7. Security and data integrity

* **IPC isolation:** Tauri restricts calls to the registered command set; no eval or arbitrary shell execution.
* **Filesystem limits:** Attachment operations are confined to `$APPDATA/attachments/**`.
* **Input sanitisation:** All incoming text fields trimmed and escaped; multi-byte characters stored as UTF-8.
* **Crash isolation:** A panic in any Pets handler is trapped by `dispatch_async_app_result`; the user sees a stable error message with a crash ID.

---

## 8. Cross-domain interactions

| Interaction        | Purpose                                  | Direction                      |
| ------------------ | ---------------------------------------- | ------------------------------ |
| Family ↔ Pets      | Shared household scoping and exports.    | Parallel, not hierarchical.    |
| Vault ↔ Pets       | Attachment path validation and repair.   | Downstream (Pets → Vault).     |
| Diagnostics ↔ Pets | Includes pets/medical counts in reports. | Upstream (Diagnostics ← Pets). |
| Logging ↔ Pets     | Writes event telemetry.                   | Bidirectional.                 |

No IPC endpoint outside the Pets module calls Pets commands directly.

---

## 9. Example workflows

### Create Pet → Add Medical Record → Schedule Reminder

1. Front end calls `pets_create` with name/type.
2. On success, it retrieves the new pet ID.
3. Calls `pet_medical_create` with the pet ID and optional `reminder_at`.
4. `PetsView` scheduler sets a `setTimeout` for each reminder timestamp.
5. Any IPC failure triggers `showError` toast and logs structured error JSON.

### Delete Pet

1. `pets_delete` sets `deleted_at` for the pet.
2. FK cascades delete all its `pet_medical` rows.
3. UI refreshes via `pets_list`; reminders for deleted pets are ignored.

---

## 10. Validation examples

```jsonc
{
  "ok": false,
  "error": {
    "code": "HOUSEHOLD_NOT_FOUND",
    "message": "Household context missing for pets_create"
  }
}
```

```jsonc
{
  "ok": false,
  "error": {
    "code": "ATTACHMENT_OUT_OF_VAULT",
    "message": "Attachment path must reside under $APPDATA/attachments"
  }
}
```

```jsonc
{
  "ok": false,
  "error": {
    "code": "UNIQUE_CONSTRAINT_FAILED",
    "message": "Microchip number already registered"
  }
}
```

---

## 11. Testing coverage

* **Unit tests (Rust):** Validate CRUD operations, FK enforcement, and attachment guard rejection. Files: `tests/pets_crud.rs`, `tests/pet_medical_guard.rs`.
* **Integration tests (TypeScript):** Simulated IPC round-trips in test harness; check expected `ok: true` and error surfaces. Files: `tests/ui/petsIpc.test.ts` (planned).
* **Performance sniff:** Round-trip latency targets: < 5 ms per create/update on local SQLite; < 50 ms for 100-row list.

---

## 12. Known limitations

* `pets_*` and `pet_medical_*` commands have no version suffix; schema changes require coordinated updates on both ends.
* IPC does not currently support batch insert or transactional multi-create.
* No streaming for large attachment metadata sets; pagination is simple offset/limit.
* Lack of deep-link support—IPC responses cannot yet trigger route navigation automatically.
* Error codes not yet localised; UI provides English copy only.

---

**Owner:** Ged McSneggle  
**Status:** Stable as of schema 0026 and IPC contracts v2 baseline  
**Scope:** Defines Pets IPC endpoints, validation rules, and error taxonomy for closed-beta readiness

