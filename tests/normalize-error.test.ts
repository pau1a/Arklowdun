import assert from "node:assert/strict";
import { test } from "node:test";


const SAMPLE_CODE = "SQLX/ROW_NOT_FOUND";

test("normalizeError preserves cause and coerces context values to strings", async () => {
  const { normalizeError } = await import("../src/db/call.ts");
  const rawError = {
    code: SAMPLE_CODE,
    message: "Record not found",
    context: { id: 42, stale: false },
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

  // cause
  assert.ok(n.cause);
  assert.equal(n.cause!.code, "APP/UNKNOWN");
  assert.equal(n.cause!.message, "sql row missing");
  assert.ok(n.cause!.context);
  assert.equal(n.cause!.context!.reason, "missing");
});

test("normalizeError wraps bare strings with fallback code", async () => {
  const { normalizeError } = await import("../src/db/call.ts");
  const n = normalizeError("boom");
  assert.equal(n.code, "APP/UNKNOWN");
  assert.equal(n.message, "boom");
});

test("normalizeError handles { message } objects", async () => {
  const { normalizeError } = await import("../src/db/call.ts");
  const n = normalizeError({ message: "boom" });
  assert.equal(n.code, "APP/UNKNOWN");
  assert.equal(n.message, "boom");
});
