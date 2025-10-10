import assert from "node:assert/strict";
import { test } from "node:test";


const SAMPLE_CODE = "SQLX/ROW_NOT_FOUND";

test("normalizeError preserves cause and coerces context values to strings", async () => {
  const { normalizeError } = await import("../src/lib/ipc/call.ts");
  const rawError = {
    code: SAMPLE_CODE,
    message: "Record not found",
    context: { id: 42, stale: false },
    crash_id: "01890123-aaaa-bbbb-cccc-abcdefabcdef",
    cause: {
      message: "sql row missing",
      context: { reason: ["missing"] },
    },
  } as const;

  const n = normalizeError(rawError);

  // top-level
  assert.equal(n.code, SAMPLE_CODE);
  assert.equal(n.message, "Record not found");
  assert.ok(n.context);
  assert.equal(n.context!.id, "42");
  assert.equal(n.context!.stale, "false");
  assert.equal(n.crash_id, "01890123-aaaa-bbbb-cccc-abcdefabcdef");

  // cause
  assert.ok(n.cause);
  assert.equal(n.cause!.code, "APP/UNKNOWN");
  assert.equal(n.cause!.message, "sql row missing");
  assert.ok(n.cause!.context);
  assert.equal(n.cause!.context!.reason, "missing");
});

test("normalizeError wraps bare strings with fallback code", async () => {
  const { normalizeError } = await import("../src/lib/ipc/call.ts");
  const n = normalizeError("boom");
  assert.equal(n.code, "APP/UNKNOWN");
  assert.equal(n.message, "boom");
});

test("normalizeError handles { message } objects", async () => {
  const { normalizeError } = await import("../src/lib/ipc/call.ts");
  const n = normalizeError({ message: "boom" });
  assert.equal(n.code, "APP/UNKNOWN");
  assert.equal(n.message, "boom");
});

test("normalizeError surfaces database health report", async () => {
  const {
    normalizeError,
    DB_UNHEALTHY_WRITE_BLOCKED,
    DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE,
  } = await import("../src/lib/ipc/call.ts");

  const report = {
    status: "error",
    checks: [],
    offenders: [],
    schema_hash: "hash",
    app_version: "test",
    generated_at: "2024-01-01T00:00:00Z",
  } as const;

  const n = normalizeError({
    code: DB_UNHEALTHY_WRITE_BLOCKED,
    message: "some other message",
    health_report: report,
  });

  assert.equal(n.code, DB_UNHEALTHY_WRITE_BLOCKED);
  assert.equal(n.message, DB_UNHEALTHY_WRITE_BLOCKED_MESSAGE);
  assert.deepEqual(n.health_report, report);
});

test("normalizeError maps persistence error codes to user copy", async () => {
  const { normalizeError } = await import("../src/lib/ipc/call.ts");
  const cases = [
    { code: "INVALID_HOUSEHOLD", expected: "No active household selected." },
    { code: "SQLX/UNIQUE", expected: "Duplicate entry detected." },
    { code: "SQLX/NOTNULL", expected: "Required field missing." },
    { code: "PATH_OUT_OF_VAULT", expected: "File path outside vault boundary." },
    { code: "APP/UNKNOWN", expected: "Unexpected error occurred." },
  ] as const;

  for (const { code, expected } of cases) {
    const result = normalizeError({ code, message: "raw" });
    assert.equal(result.code, code);
    assert.equal(result.message, expected);
  }
});
