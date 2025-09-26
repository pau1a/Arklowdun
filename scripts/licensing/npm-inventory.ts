import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import {
  DependencyType,
  Inventory,
  InventoryDependency,
  InventorySource,
  dedupeStrings,
  sortDependencies
} from "./lib/utils.ts";
import { normaliseLicenses } from "./lib/spdx.ts";
import { loadOverrides, Overrides } from "./lib/overrides.ts";

type LockfilePackage = {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  license?: string | string[] | { type?: string };
  licenses?: Array<string | { type?: string }>;
  deprecated?: string;
};

type Lockfile = {
  packages?: Record<string, LockfilePackage>;
};

type GenerateInventoryOptions = {
  lockfilePath: string;
  schemaPath: string;
  projectRoot: string;
  overrides: Overrides;
  warn: (message: string) => void;
};

function normaliseName(key: string, pkg: LockfilePackage): string {
  if (pkg.name && pkg.name.trim().length > 0) {
    return pkg.name.trim();
  }
  const segments = key.split("node_modules/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last ?? key;
}


export async function generateInventory({
  lockfilePath,
  schemaPath,
  projectRoot,
  overrides,
  warn
}: GenerateInventoryOptions): Promise<Inventory> {
  const raw = await readFile(lockfilePath, "utf8");
  const lockfile: Lockfile = JSON.parse(raw);
  const packages = lockfile.packages ?? {};

  const rootPackage = packages[""] ?? {};
  const directDependencies = new Set<string>();
  for (const collection of [
    (rootPackage as any).dependencies,
    (rootPackage as any).devDependencies,
    (rootPackage as any).optionalDependencies
  ]) {
    if (!collection) continue;
    for (const name of Object.keys(collection)) {
      directDependencies.add(name);
    }
  }

  const inventoryMap = new Map<string, InventoryDependency>();

  for (const [key, pkg] of Object.entries(packages)) {
    if (key === "") continue;
    const name = normaliseName(key, pkg);
    const version = pkg.version ?? "0.0.0";
    const mapKey = `${name}@${version}`;

    const override = overrides.get(name, version, "npm");

    const { licenses, missing, unparsable } = normaliseLicenses(pkg.licenses ?? pkg.license, override);
    if (missing) {
      warn(`License metadata missing for ${mapKey}`);
    }
    for (const fragment of unparsable) {
      warn(`Unable to parse license expression for ${mapKey}: ${fragment}`);
    }

    const resolved = pkg.resolved ?? "UNKNOWN";
    const checksum = pkg.integrity ?? "UNKNOWN";
    const dependencyType: DependencyType = directDependencies.has(name) ? "direct" : "indirect";

    const notes: string[] = [];
    if (override?.notes) {
      notes.push(override.notes);
    }
    if (missing && !override?.licenses) {
      notes.push("license metadata unavailable in lockfile");
    }
    if (pkg.deprecated) {
      notes.push(pkg.deprecated.trim());
    }

    const source: InventorySource = {
      type: "npm",
      location: resolved !== "UNKNOWN" ? resolved : name
    };

    const entry: InventoryDependency = {
      name,
      version,
      resolved,
      checksum,
      dependencyType,
      licenses,
      source,
      provenance: [
        {
          ecosystem: "npm",
          dependencyType,
          resolved,
          checksum,
          source
        }
      ]
    };

    if (notes.length > 0) {
      entry.notes = notes.join("; ");
    }

    if (inventoryMap.has(mapKey)) {
      const existing = inventoryMap.get(mapKey)!;
      existing.licenses = dedupeStrings([...existing.licenses, ...entry.licenses]);
      if (entry.dependencyType === "direct") {
        existing.dependencyType = "direct";
      }
      existing.provenance.push(...entry.provenance);
      if (entry.notes) {
        const existingNotes = existing.notes ? existing.notes.split("; ").filter(Boolean) : [];
        existing.notes = sortNotes([...existingNotes, entry.notes]);
      }
      continue;
    }

    inventoryMap.set(mapKey, entry);
  }

  const dependencies = sortDependencies(Array.from(inventoryMap.values()));

  const inventory: Inventory = {
    generatedAt: new Date().toISOString(),
    source: {
      type: "npm",
      lockfile: relative(projectRoot, lockfilePath)
    },
    dependencies
  };

  const schemaRaw = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(inventory)) {
    const errors = validate.errors ?? [];
    const details = errors.map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`Generated inventory does not satisfy schema: ${details}`);
  }

  return inventory;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sortNotes(notes: string[]): string {
  return Array.from(new Set(notes.map((note) => note.trim()).filter(Boolean))).join("; ");
}

async function main() {
  const { values } = parseArgs({
    options: {
      lockfile: { type: "string", short: "l" },
      output: { type: "string", short: "o" },
      schema: { type: "string", short: "s" },
      overrides: { type: "string" }
    }
  });

  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const lockfilePath = values.lockfile
    ? resolve(values.lockfile)
    : join(projectRoot, "package-lock.json");
  const schemaPath = values.schema
    ? resolve(values.schema)
    : join(projectRoot, "schema", "licensing-inventory.schema.json");
  const outputPath = values.output
    ? resolve(values.output)
    : join(projectRoot, "artifacts", "licensing", "npm-inventory.json");
  const defaultOverridesPath = join(projectRoot, "scripts", "licensing", "overrides.yaml");
  const overridesPath = values.overrides
    ? resolve(values.overrides)
    : (await fileExists(defaultOverridesPath))
        ? defaultOverridesPath
        : undefined;
  const overrides = await loadOverrides(overridesPath);

  const warnings: string[] = [];
  const inventory = await generateInventory({
    lockfilePath,
    schemaPath,
    projectRoot,
    overrides,
    warn: (message) => {
      warnings.push(message);
      console.warn(message);
    }
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(inventory, null, 2) + "\n");

  const relativeOutput = relative(projectRoot, outputPath);
  console.log(`Wrote ${relativeOutput} with ${inventory.dependencies.length} entries.`);

  if (warnings.length > 0) {
    process.exitCode = 2;
    console.warn(
      `${warnings.length} licensing warnings emitted. Review overrides or resolve upstream metadata.`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
