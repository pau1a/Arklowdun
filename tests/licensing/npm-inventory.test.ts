import { strict as assert } from "node:assert";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateInventory } from "../../scripts/licensing/npm-inventory.ts";
import { Overrides, loadOverrides } from "../../scripts/licensing/lib/overrides.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function normaliseForComparison<T extends { generatedAt: string }>(inventory: T) {
  return { ...inventory, generatedAt: "2024-01-01T00:00:00.000Z" };
}

test("parses fixture lockfile", async () => {
  const warnings: string[] = [];
  const inventory = await generateInventory({
    lockfilePath: join(ROOT, "fixtures/licensing/package-lock.fixture.json"),
    schemaPath: join(ROOT, "schema/licensing-inventory.schema.json"),
    projectRoot: ROOT,
    overrides: new Overrides(),
    warn: (message) => warnings.push(message)
  });

  assert.equal(inventory.dependencies.length, 5);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /charlie@3\.0\.0/);

  const expected = JSON.parse(
    await readFile(join(ROOT, "fixtures/licensing/npm-inventory.json"), "utf8")
  );

  assert.deepEqual(normaliseForComparison(inventory), expected);
});

test("deduplicates repeated package entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "licensing-inventory-"));
  const lockfilePath = join(dir, "package-lock.json");

  const lockfile = {
    name: "dedupe",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "dedupe",
        version: "0.0.0",
        dependencies: {
          foo: "1.0.0",
          bar: "2.0.0"
        }
      },
      "node_modules/foo": {
        name: "foo",
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
        integrity: "sha512-foo",
        license: "MIT"
      },
      "node_modules/bar": {
        name: "bar",
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/bar/-/bar-2.0.0.tgz",
        integrity: "sha512-bar",
        license: "ISC",
        dependencies: {
          foo: "1.0.0"
        }
      },
      "node_modules/bar/node_modules/foo": {
        name: "foo",
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
        integrity: "sha512-foo",
        license: "MIT"
      }
    }
  };

  await writeFile(lockfilePath, JSON.stringify(lockfile, null, 2));

  const warnings: string[] = [];
  const inventory = await generateInventory({
    lockfilePath,
    schemaPath: join(ROOT, "schema/licensing-inventory.schema.json"),
    projectRoot: dir,
    overrides: new Overrides(),
    warn: (message) => warnings.push(message)
  });

  assert.equal(warnings.length, 0);
  const fooEntries = inventory.dependencies.filter((entry) => entry.name === "foo");
  assert.equal(fooEntries.length, 1);
  assert.equal(fooEntries[0]?.dependencyType, "direct");
  assert.deepEqual(fooEntries[0]?.licenses, ["MIT"]);
  assert.equal(fooEntries[0]?.provenance.length, 2);
});

test("applies manual overrides", async () => {
  const overrideDir = await mkdtemp(join(tmpdir(), "licensing-overrides-"));
  const overridePath = join(overrideDir, "overrides.json");
  await writeFile(
    overridePath,
    JSON.stringify(
      {
        "charlie@3.0.0": {
          licenses: ["Apache-2.0"],
          notes: "Manual remediation applied for testing"
        }
      },
      null,
      2
    )
  );

  const warnings: string[] = [];
  const overrides = await loadOverrides(overridePath);
  const inventory = await generateInventory({
    lockfilePath: join(ROOT, "fixtures/licensing/package-lock.fixture.json"),
    schemaPath: join(ROOT, "schema/licensing-inventory.schema.json"),
    projectRoot: ROOT,
    overrides,
    warn: (message) => warnings.push(message)
  });

  const charlie = inventory.dependencies.find((entry) => entry.name === "charlie");
  assert.deepEqual(charlie?.licenses, ["Apache-2.0"]);
  assert.ok(charlie?.notes?.includes("Manual remediation"));
  assert.equal(warnings.length, 0);
});
