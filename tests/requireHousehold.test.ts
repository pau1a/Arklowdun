import { requireHousehold } from "../src/db/household.ts";
import assert from "node:assert";
import test from "node:test";

test("requireHousehold rejects falsy ids", () => {
  for (const v of [undefined, null, ""] as any[]) {
    assert.throws(() => requireHousehold(v), /householdId required/);
  }
});

test("requireHousehold returns id", () => {
  assert.equal(requireHousehold("abc"), "abc");
});
