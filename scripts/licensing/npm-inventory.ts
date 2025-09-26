import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import spdxParse from "spdx-expression-parse";

type DependencyType = "direct" | "indirect";

type InventoryDependency = {
  name: string;
  version: string;
  resolved: string;
  checksum: string;
  dependencyType: DependencyType;
  licenses: string[];
  source: {
    type: "npm" | "git" | "manual";
    location: string;
  };
  notes?: string;
};

type Inventory = {
  generatedAt: string;
  source: {
    packageManager: "npm";
    lockfile: string;
  };
  dependencies: InventoryDependency[];
};

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
  overridesPath?: string;
  warn: (message: string) => void;
};

type OverrideRecord = Record<string, { licenses?: string[]; notes?: string }>;

function normaliseName(key: string, pkg: LockfilePackage): string {
  if (pkg.name && pkg.name.trim().length > 0) {
    return pkg.name.trim();
  }
  const segments = key.split("node_modules/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last ?? key;
}

function normaliseLicenses(
  pkg: LockfilePackage,
  override?: { licenses?: string[] }
): { licenses: string[]; missing: boolean; unparsable: string[] } {
  if (override?.licenses && override.licenses.length > 0) {
    return { licenses: dedupeStrings(override.licenses), missing: false, unparsable: [] };
  }

  const raw = pkg.licenses ?? pkg.license;
  if (!raw) {
    return { licenses: ["UNKNOWN"], missing: true, unparsable: [] };
  }

  const candidates = Array.isArray(raw) ? raw : [raw];
  const licenses: string[] = [];
  const unparsable: string[] = [];

  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : candidate.type?.trim();
    if (!value) {
      continue;
    }

    try {
      const parsed = spdxParse(value);
      collectSpdx(parsed, licenses);
    } catch (error) {
      // Either a simple SPDX identifier or unparsable expression.
      if (/^[A-Za-z0-9.+-]+$/.test(value)) {
        licenses.push(value);
      } else {
        unparsable.push(value);
      }
    }
  }

  if (licenses.length === 0) {
    return { licenses: ["UNKNOWN"], missing: true, unparsable };
  }

  return { licenses: dedupeStrings(licenses), missing: false, unparsable };
}

function collectSpdx(node: any, accumulator: string[]) {
  if (!node) return;
  if (node.license) {
    const license = String(node.license);
    if (node.exception) {
      accumulator.push(`${license} WITH ${node.exception}`);
    } else {
      accumulator.push(license);
    }
    return;
  }

  if (node.left && node.right) {
    collectSpdx(node.left, accumulator);
    collectSpdx(node.right, accumulator);
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      output.push(trimmed);
    }
  }
  return output;
}

async function loadOverrides(path: string | undefined): Promise<OverrideRecord> {
  if (!path) {
    return {};
  }

  try {
    await access(path, fsConstants.F_OK);
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as OverrideRecord;
    }
    throw new Error("Overrides file must contain a JSON object");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`Overrides file not found: ${path}`);
    }
    throw error;
  }
}

export async function generateInventory({
  lockfilePath,
  schemaPath,
  projectRoot,
  overridesPath,
  warn
}: GenerateInventoryOptions): Promise<Inventory> {
  const raw = await readFile(lockfilePath, "utf8");
  const lockfile: Lockfile = JSON.parse(raw);
  const packages = lockfile.packages ?? {};
  const overrides = await loadOverrides(overridesPath);

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

    const override = overrides[mapKey] ?? overrides[name];

    const { licenses, missing, unparsable } = normaliseLicenses(pkg, override);
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

    const entry: InventoryDependency = {
      name,
      version,
      resolved,
      checksum,
      dependencyType,
      licenses,
      source: {
        type: "npm",
        location: resolved !== "UNKNOWN" ? resolved : name
      }
    };

    if (notes.length > 0) {
      entry.notes = notes.join("; ");
    }

    if (inventoryMap.has(mapKey)) {
      const existing = inventoryMap.get(mapKey)!;
      existing.licenses = dedupeStrings([...existing.licenses, ...entry.licenses]);
      if (entry.notes) {
        existing.notes = existing.notes
          ? dedupeStrings([...existing.notes.split("; ").filter(Boolean), entry.notes]).join("; ")
          : entry.notes;
      }
      continue;
    }

    inventoryMap.set(mapKey, entry);
  }

  const dependencies = Array.from(inventoryMap.values()).sort((a, b) => {
    return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
  });

  const inventory: Inventory = {
    generatedAt: new Date().toISOString(),
    source: {
      packageManager: "npm",
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
  const defaultOverridesPath = join(projectRoot, "scripts", "licensing", "npm-overrides.json");
  const overridesPath = values.overrides
    ? resolve(values.overrides)
    : (await fileExists(defaultOverridesPath))
        ? defaultOverridesPath
        : undefined;

  const warnings: string[] = [];
  const inventory = await generateInventory({
    lockfilePath,
    schemaPath,
    projectRoot,
    overridesPath,
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
