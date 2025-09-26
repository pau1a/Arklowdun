import { strict as assert } from "node:assert";
import test from "node:test";
import { mergeInventories } from "../../scripts/licensing/lib/merge.ts";
import { Overrides } from "../../scripts/licensing/lib/overrides.ts";
import { Inventory } from "../../scripts/licensing/lib/utils.ts";

test("requires override for conflicting licenses", () => {
  const npmInventory: Inventory = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    source: { type: "npm", lockfile: "package-lock.json" },
    dependencies: [
      {
        name: "shared",
        version: "1.0.0",
        dependencyType: "direct",
        licenses: ["MIT"],
        resolved: "https://registry.npmjs.org/shared/-/shared-1.0.0.tgz",
        checksum: "sha512-shared",
        source: { type: "npm", location: "https://registry.npmjs.org/shared/-/shared-1.0.0.tgz" },
        provenance: [
          {
            ecosystem: "npm",
            dependencyType: "direct",
            resolved: "https://registry.npmjs.org/shared/-/shared-1.0.0.tgz",
            checksum: "sha512-shared",
            source: { type: "npm", location: "https://registry.npmjs.org/shared/-/shared-1.0.0.tgz" }
          }
        ]
      }
    ]
  };

  const cargoInventory: Inventory = {
    generatedAt: "2024-01-01T00:00:00.000Z",
    source: { type: "cargo", lockfile: "Cargo.lock", metadata: "Cargo.toml" },
    dependencies: [
      {
        name: "shared",
        version: "1.0.0",
        dependencyType: "direct",
        licenses: ["Apache-2.0"],
        resolved: "git+https://example.com/shared#abcdef",
        checksum: "UNKNOWN",
        source: { type: "git", location: "git+https://example.com/shared#abcdef" },
        provenance: [
          {
            ecosystem: "cargo",
            dependencyType: "direct",
            resolved: "git+https://example.com/shared#abcdef",
            checksum: "UNKNOWN",
            source: { type: "git", location: "git+https://example.com/shared#abcdef" }
          }
        ]
      }
    ]
  };

  assert.throws(() => mergeInventories([npmInventory, cargoInventory], new Overrides()));

  const overrides = new Overrides({
    "shared@1.0.0": {
      licenses: ["MIT", "Apache-2.0"],
      notes: "Dual-licensed upstream component",
      ecosystems: ["aggregate"]
    }
  });

  const combined = mergeInventories([npmInventory, cargoInventory], overrides);

  assert.equal(combined.dependencies.length, 1);
  const shared = combined.dependencies[0];
  assert.deepEqual(shared.licenses, ["MIT", "Apache-2.0"]);
  assert.equal(shared.source.type, "aggregate");
  assert.equal(shared.resolved, "UNKNOWN");
  assert.equal(shared.checksum, "UNKNOWN");
  assert.ok(shared.notes?.includes("Dual-licensed"));
  assert.equal(shared.provenance.length, 2);
  overrides.assertAllUsed(["aggregate"]);
});
