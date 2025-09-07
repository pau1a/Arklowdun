import assert from "node:assert";
import test from "node:test";
import { fmt } from "../src/ui/fmt.ts";

test("fmt returns em dash for undefined/null/0", () => {
  assert.equal(fmt(undefined), "—");
  assert.equal(fmt(null), "—");
  assert.equal(fmt(0), "—");
});

