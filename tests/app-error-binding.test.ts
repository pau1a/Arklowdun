import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("AppError.ts uses context: Record<string, string> | undefined (optional or present)", () => {
  const path = new URL("../src/bindings/AppError.ts", import.meta.url);
  const txt = fs.readFileSync(path, "utf8");
  // Accept both `context?: Record<string,string> | undefined` and
  // `context: Record<string,string> | undefined` (ts-rs may omit `?` when using a union type override).
  const re = /context\??\s*:\s*Record<string,\s*string>\s*\|\s*undefined/;
  assert.match(txt, re);

  const crash = /crash_id\??\s*:\s*string(?:\s*\|\s*undefined)?/;
  assert.match(txt, crash);
});
