import assert from "node:assert";
import test from "node:test";

test("requireHousehold rejects falsy ids", async () => {
  globalThis.__TAURI__ = { core: { invoke: async () => null } };
  const { requireHousehold } = await import("../src/db/household.ts");
  for (const v of [undefined, null, ""] as any[]) {
    assert.throws(() => requireHousehold(v), /householdId required/);
  }
});

test("requireHousehold returns id", async () => {
  globalThis.__TAURI__ = { core: { invoke: async () => null } };
  const { requireHousehold } = await import("../src/db/household.ts");
  assert.equal(requireHousehold("abc"), "abc");
});
