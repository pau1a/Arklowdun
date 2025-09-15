import { strict as assert } from "node:assert";
import test from "node:test";

import { normalizeError } from "../src/db/call.ts";

const SAMPLE_CODE = "SQLX/ROW_NOT_FOUND";

const rawError = {
  code: SAMPLE_CODE,
  message: "Record not found",
  context: { id: 42, stale: false },
  cause: {
    message: "sql row missing",
    context: { reason: ["missing"] },
  },
};

test("normalizeError preserves cause and coerces context values to strings", () => {
  const normalized = normalizeError(rawError);

  assert.deepEqual(normalized, {
    code: SAMPLE_CODE,
    message: "Record not found",
    context: {
      id: "42",
      stale: "false",
    },
    cause: {
      code: "APP/UNKNOWN",
      message: "sql row missing",
      context: {
        reason: "missing",
      },
    },
  });
});

test("normalizeError wraps bare strings with fallback code", () => {
  const normalized = normalizeError("boom");

  assert.deepEqual(normalized, {
    code: "APP/UNKNOWN",
    message: "boom",
  });
});
