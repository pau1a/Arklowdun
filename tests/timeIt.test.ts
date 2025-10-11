import { strict as assert } from "node:assert";
import test from "node:test";

import { timeIt, __testing } from "../src/lib/obs/timeIt";

test.afterEach(() => {
  __testing.reset();
});

function setupMocks() {
  const logCalls: Array<{ level: string; cmd: string; details: Record<string, unknown> }> = [];
  __testing.setDependencies({
    logUI(level: string, cmd: string, details: Record<string, unknown>) {
      logCalls.push({ level, cmd, details });
    },
    normalizeError(err: unknown) {
      return {
        code: "TEST/ERROR",
        message: err instanceof Error ? err.message : String(err ?? "unknown"),
        crash_id: "crash-123",
      };
    },
    now: () => 1000,
  });
  return { timeIt, logCalls };
}

await test("timeIt logs success metrics", { concurrency: false }, async () => {
  const { timeIt, logCalls } = await setupMocks();
  const result = await timeIt("list.load", async () => 42, {
    successFields: (value) => ({ value }),
  });
  assert.equal(result, 42);
  assert.equal(logCalls.length, 1);
  const entry = logCalls[0]!;
  assert.equal(entry.level, "INFO");
  assert.equal(entry.cmd, "perf.pets.timing");
  assert.equal(entry.details.name, "list.load");
  assert.equal(entry.details.ok, true);
  assert.equal(entry.details.value, 42);
});

await test("timeIt logs failures with crash id", { concurrency: false }, async () => {
  const { timeIt, logCalls } = await setupMocks();
  const boom = new Error("boom");
  try {
    await timeIt("detail.medical_create", async () => {
      throw boom;
    });
    assert.fail("expected rejection");
  } catch (error) {
    assert.equal((error as { code: string }).code, "TEST/ERROR");
  }
  assert.equal(logCalls.length, 1);
  const entry = logCalls[0]!;
  assert.equal(entry.level, "WARN");
  assert.equal(entry.details.ok, false);
  assert.equal(entry.details.code, "TEST/ERROR");
  assert.equal(entry.details.crash_id, "crash-123");
});

await test("classifySuccess toggles ok flag", { concurrency: false }, async () => {
  const { timeIt, logCalls } = await setupMocks();
  const result = await timeIt("detail.attach_open", async () => false, {
    classifySuccess: (value) => value === true,
    softErrorFields: (value) => ({ result: value }),
  });
  assert.equal(result, false);
  assert.equal(logCalls.length, 1);
  const entry = logCalls[0]!;
  assert.equal(entry.details.ok, false);
  assert.equal(entry.details.result, false);
});
