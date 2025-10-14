import assert from "node:assert/strict";
import test from "node:test";
import { getContract } from "../../src/lib/ipc/port";

test("household_update accepts legacy and colour-enhanced payloads", () => {
  const contract = getContract("household_update");
  assert.doesNotThrow(() =>
    contract.request.parse({ args: { id: "h1", name: "Primary" } }),
  );
  assert.doesNotThrow(() =>
    contract.request.parse({ args: { id: "h1", color: "#336699" } }),
  );
});

test("household_list tolerates records without colour fields", () => {
  const contract = getContract("household_list");
  assert.doesNotThrow(() =>
    contract.response.parse([{ id: "h1", name: "Primary", is_default: 1 }]),
  );
  assert.doesNotThrow(() =>
    contract.response.parse([
      { id: "h1", name: "Primary", is_default: 1, color: "#112233" },
    ]),
  );
});

test("vehicles_create gracefully handles missing optional maintenance dates", () => {
  const contract = getContract("vehicles_create");
  assert.doesNotThrow(() =>
    contract.request.parse({
      householdId: "h1",
      data: { household_id: "h1", name: "Car", make: "Ford", model: "Focus", reg: "REG-1" },
    }),
  );
  assert.doesNotThrow(() =>
    contract.request.parse({
      householdId: "h1",
      data: {
        household_id: "h1",
        name: "Car",
        make: "Ford",
        model: "Focus",
        vin: "VINVINVINVINVINV",
        next_mot_due: 1000,
        next_service_due: null,
      },
    }),
  );
});

