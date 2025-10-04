import { strict as assert } from "node:assert";
import test from "node:test";

import { normaliseHouseholdStats } from "../../src/api/diagnostics";

test("normaliseHouseholdStats coerces numeric flags and drops invalid counts", () => {
  const entry = normaliseHouseholdStats({
    id: "hh-alpha",
    name: "Alpha",
    is_default: 1,
    counts: {
      notes: 4,
      events: 0,
      junk: "oops",
      nested: { not: "number" },
    },
  });

  assert.equal(entry.id, "hh-alpha");
  assert.equal(entry.name, "Alpha");
  assert.equal(entry.isDefault, true);
  assert.deepEqual(entry.counts, { notes: 4, events: 0 });
});

test("normaliseHouseholdStats falls back to the household id and zero flag", () => {
  const entry = normaliseHouseholdStats({
    id: "hh-beta",
    name: "   ",
    is_default: 0,
    counts: null,
  });

  assert.equal(entry.id, "hh-beta");
  assert.equal(entry.name, "hh-beta");
  assert.equal(entry.isDefault, false);
  assert.deepEqual(entry.counts, {});
});
