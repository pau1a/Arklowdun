import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateCargoInventory } from "../../scripts/licensing/cargo-inventory.ts";
import { Overrides } from "../../scripts/licensing/lib/overrides.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function normaliseGeneratedAt<T extends { generatedAt: string }>(inventory: T) {
  return { ...inventory, generatedAt: "2024-01-01T00:00:00.000Z" };
}

test("parses cargo fixtures", async () => {
  const warnings: string[] = [];
  const inventory = await generateCargoInventory({
    lockfilePath: join(ROOT, "fixtures/licensing/Cargo.lock.fixture"),
    schemaPath: join(ROOT, "schema/licensing-inventory.schema.json"),
    projectRoot: ROOT,
    overrides: new Overrides(),
    metadataPath: join(ROOT, "fixtures/licensing/cargo-metadata.json"),
    warn: (message) => warnings.push(message)
  });

  assert.equal(inventory.dependencies.length, 4);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.some((message) => message.includes("local-dep@0.3.0")));
  assert.ok(warnings.some((message) => message.includes("missing-license@0.4.0")));

  const expected = JSON.parse(
    await readFile(join(ROOT, "fixtures/licensing/cargo-inventory.json"), "utf8")
  );

  assert.deepEqual(normaliseGeneratedAt(inventory), expected);
});
