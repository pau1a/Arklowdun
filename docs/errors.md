# Error Handling

`AppError` is the structured error type returned by every Tauri command. It keeps
machine readable metadata alongside a user friendly message so the UI and logs can
surface consistent information without bespoke adapters.

## Fields

`AppError` is a simple struct with four pieces of data:

- **`code: String`** – machine readable identifier (e.g. `"VALIDATION"`,
  `"Sqlite/2067"`). Codes let the UI translate recurring issues into localized
  copy or automatic retries.
- **`message: String`** – human friendly description that can be displayed
  directly. Messages should be short, single-sentence summaries.
- **`context: HashMap<String, String>`** – optional key/value metadata carrying
  record IDs, file paths, SQL details, etc. The map is skipped when empty and the
  generated TypeScript binding marks it as `Record<string, string> | undefined`.
- **`cause: Option<Box<AppError>>`** – optional nested `AppError` preserving the
  upstream error chain.

The struct derives `Serialize`, `Deserialize`, and `ts_rs::TS`, so the same shape
is exposed to TypeScript under `src/bindings/AppError.ts` whenever the crate is
compiled.

### Wire format example

```json
{
  "code": "SQLX/ROW_NOT_FOUND",
  "message": "Record not found",
  "context": {
    "entity": "events",
    "id": "abc-123"
  }
}
```

## Codes

Two helper constants exist:

- `AppError::GENERIC_CODE` → used when constructing an error from a free-form
  message (e.g. `AppError::from("missing name")`).
- `AppError::UNKNOWN_CODE` → fallback for upstream errors that do not provide a
  code when converted from `anyhow::Error` or similar wrappers.

Domain specific code strings are encouraged when the caller can provide them.
When converting SQL queries, driver-level issues (pool timeouts, decode
failures, missing rows) use the `SQLX/*` prefix while raw SQLite engine
responses keep the native code under `Sqlite/<number>`.

- `DB_UNHEALTHY_WRITE_BLOCKED` → returned by the IPC/CLI guard whenever the
  cached database health report is not `Ok`. The payload includes the full
  report so the UI can show the banner and toast without issuing another
  `db_get_health_report` call. Mutating CLI subcommands abort with exit code `2`
  (see `DB_UNHEALTHY_EXIT_CODE`) so automation can detect the guard failure.

  The attached `DbHealthReport` contains:

  - `status` – overall enum (`Ok`, `Error`, or `Warning`).
  - `checks` – individual check outcomes with human readable descriptions.
  - `offenders` – redacted references to affected tables/rowids.
  - `schema_hash` – hash of the schema used for compatibility checks.
  - `app_version` – application version that produced the report.
  - `generated_at` – ISO8601 timestamp when the report was captured.

## Conversions

The module implements several `From` conversions so higher level code can reuse
existing types without boilerplate:

- `&str`/`String` → `AppError` – quick creation helpers for validation failures
  and other UI facing errors.
- `std::io::Error` → `AppError` – captures the OS error code (when available) and
  tags the error as `IO/<Kind>`.
- `serde_json::Error` → `AppError` – distinguishes between syntax/data/EOF errors
  and records the failing line/column when known.
- `sqlx::Error` → `AppError` – maps framework errors into `SQLX/<category>` and
  engine codes into `Sqlite/<code>`, keeping constraint names or pool issues in
  `context`.
- `anyhow::Error ↔ AppError` – preserves the error chain by nesting causes. The
  top level message becomes the primary `AppError` while sources become nested
  causes.

Because `AppError` implements `std::error::Error`, it can be wrapped in `anyhow`
or other error handling libraries and still report causes correctly.

## Usage

Every command in `commands.rs` now returns `AppResult<T> = Result<T, AppError>`.
The `lib.rs` handlers simply forward those results so the IPC boundary sees the
same structure. Helpers like `attachments::open_with_os` and
`events_backfill_timezone` also return `AppError` directly, so the previous
translation shim has been removed.

Creating a validation error with context:

```rust
use arklowdun_lib::AppError;

let err = AppError::new("VALIDATION", "Missing field")
    .with_context("field", "name")
    .with_context("household_id", "abc-123");
```

Capturing an `anyhow::Error` chain:

```rust
use anyhow::Context;
use arklowdun_lib::AppError;

let upstream = (|| -> anyhow::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Other, "disk full"))
        .context("failed to save file")
})().unwrap_err();

let structured = AppError::from(upstream);
assert_eq!(structured.message(), "failed to save file");
assert!(structured.cause().unwrap().message().contains("disk full"));
```

## TypeScript integration

The generated binding exposes the JSON shape for the UI:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { AppError } from "../bindings/AppError";
import { normalizeError } from "@lib/ipc/call";

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    const error: AppError = normalizeError(err);
    // showError(error) / log.error(...) / etc.
    throw error;
  }
}
```

`normalizeError` coerces older Tauri error shapes (strings or `{ message }`
objects) into an `AppError` instance so the rest of the UI can assume the
standard shape.

Bindings are emitted under `src/bindings/` (created automatically by the
`src-tauri` build script) so long as builds run from the workspace root.
