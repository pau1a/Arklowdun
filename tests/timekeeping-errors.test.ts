import assert from "node:assert/strict";
import test from "node:test";

test("describeTimekeepingError maps timekeeping codes to copy", async () => {
  const { describeTimekeepingError } = await import("../src/utils/timekeepingErrors.ts");
  const descriptor = describeTimekeepingError({
    code: "E_RRULE_UNSUPPORTED_FIELD",
    message: "rrule failed to parse",
    context: { field: "FOO" },
  });

  assert.equal(descriptor.message, "This repeat pattern is not yet supported.");
  assert.ok(descriptor.detail && descriptor.detail.includes("rrule failed to parse"));
  assert.ok(descriptor.detail && descriptor.detail.includes("field: FOO"));
});

