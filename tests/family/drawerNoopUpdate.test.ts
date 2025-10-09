import assert from "node:assert/strict";
import test from "node:test";
import { familyStore } from "../../src/features/family/family.store";
import { familyRepo } from "../../src/repos";

test("does not invoke IPC when saving unchanged member", async () => {
  const originalUpdate = familyRepo.update;
  const originalList = familyRepo.list;

  let updateCalls = 0;
  familyRepo.update = (async (_householdId, _id, _data) => {
    updateCalls += 1;
  }) as typeof familyRepo.update;

  const hydratedMember = {
    id: "mem-1",
    household_id: "house-1",
    name: "Member",
    position: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  } as any;

  familyRepo.list = (async (_opts) => [hydratedMember]) as typeof familyRepo.list;

  try {
    await familyStore.load("house-1", true);
    await familyStore.upsert({ id: "mem-1" });
    assert.equal(updateCalls, 0);
  } finally {
    familyRepo.list = (async (_opts) => []) as typeof familyRepo.list;
    await familyStore.load("house-1", true);
    familyRepo.update = originalUpdate;
    familyRepo.list = originalList;
  }
});
