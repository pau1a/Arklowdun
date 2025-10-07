import { strict as assert } from "node:assert";
import test from "node:test";

import { formatTimestamp, getZoneLabel } from "../../src/features/logs/time";

test("formatTimestamp preserves ordering for UTC and local displays", () => {
  const timestamps = [
    "2024-03-30T23:45:00Z",
    "2024-03-31T00:30:00Z",
    "2024-03-31T01:30:00Z",
  ];

  const utcFormatted = timestamps.map((ts) => formatTimestamp(ts, false));
  const localFormatted = timestamps.map((ts) => formatTimestamp(ts, true));

  assert.deepEqual(utcFormatted.slice().sort(), utcFormatted);
  assert.deepEqual(localFormatted.slice().sort(), localFormatted);
});

test("formatTimestamp toggles BST and GMT labels correctly", () => {
  const winter = "2024-01-15T12:00:00Z";
  const summer = "2024-06-15T12:00:00Z";

  const winterLocal = formatTimestamp(winter, true);
  const summerLocal = formatTimestamp(summer, true);

  assert.ok(winterLocal.endsWith("GMT"), `expected winter label to be GMT, got ${winterLocal}`);
  assert.ok(summerLocal.endsWith("BST"), `expected summer label to be BST, got ${summerLocal}`);
});

test("getZoneLabel reports current local abbreviation", () => {
  const label = getZoneLabel(true);
  assert.ok(/^(BST|GMT)$/.test(label));
  assert.equal(getZoneLabel(false), "UTC");
});
