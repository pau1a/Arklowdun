import assert from "node:assert/strict";
import test from "node:test";

import {
  fnv1a32,
  formatIsoWeekKey,
  formatLondonMonthKey,
  getPeriodKey,
  getBlobSeedForPeriod,
  forceNewBlobUniverse,
} from "../src/lib/blobRotation.ts";
import {
  __resetStoreForTests,
  setStoreValue,
  getStoreValue,
  setRotationMode,
} from "../src/lib/store.ts";

function isoDate(date: string): Date {
  return new Date(date);
}

test.beforeEach(() => {
  __resetStoreForTests();
});

test("fnv1a32 is deterministic", () => {
  const a = fnv1a32("arklowdun:test");
  const b = fnv1a32("arklowdun:test");
  const c = fnv1a32("arklowdun:TEST");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("formatIsoWeekKey respects Europe/London weeks", () => {
  assert.equal(formatIsoWeekKey(isoDate("2024-03-25T12:00:00Z")), "2024-W13");
  assert.equal(formatIsoWeekKey(isoDate("2024-03-31T00:30:00Z")), "2024-W13");
  assert.equal(formatIsoWeekKey(isoDate("2024-12-31T18:00:00Z")), "2025-W01");
});

test("formatLondonMonthKey returns YYYY-MM in London time", () => {
  assert.equal(formatLondonMonthKey(isoDate("2024-03-31T00:30:00Z")), "2024-M03");
  assert.equal(formatLondonMonthKey(isoDate("2024-10-01T01:00:00Z")), "2024-M10");
});

test("monthly rotation flips at London month boundary", () => {
  const lateMarch = isoDate("2025-03-31T22:30:00Z");
  const earlyApril = isoDate("2025-04-01T00:30:00Z");
  assert.equal(getPeriodKey("monthly", lateMarch), "2025-M03");
  assert.equal(getPeriodKey("monthly", earlyApril), "2025-M04");
});

async function seedForCurrentWeek(installId: string): Promise<number> {
  const key = getPeriodKey("weekly");
  const expected = fnv1a32(`${installId}:${key}:arklowdun`);
  return expected;
}

test("weekly rotation derives deterministic seed", async () => {
  const installId = "test-install-id";
  await setStoreValue("installId", installId);
  await setRotationMode("weekly");

  const expected = await seedForCurrentWeek(installId);
  const seed = await getBlobSeedForPeriod("weekly");
  assert.equal(seed, expected);

  const storedSeed = await getStoreValue("blobSeed");
  const storedKey = await getStoreValue("blobWeekKey");
  assert.equal(storedSeed, expected);
  assert.equal(storedKey, getPeriodKey("weekly"));

  // Simulate stale week key
  await setStoreValue("blobWeekKey", "1999-W52");
  await setStoreValue("blobSeed", 1234);
  const refreshed = await getBlobSeedForPeriod("weekly");
  assert.equal(refreshed, expected);
});

test("off rotation preserves stored seed", async () => {
  await setRotationMode("off");
  await setStoreValue("installId", "persisted");
  await setStoreValue("blobSeed", 987654321);
  await setStoreValue("blobWeekKey", "static");

  const seed = await getBlobSeedForPeriod("off");
  assert.equal(seed, 987654321);
});

test("forceNewBlobUniverse updates the persisted seed", async () => {
  await setStoreValue("installId", "refresh-install");
  const first = await getBlobSeedForPeriod("weekly");
  const next = await forceNewBlobUniverse();
  const stored = await getStoreValue("blobSeed");
  assert.equal(stored, next);
  assert.notEqual(first, next);
});
