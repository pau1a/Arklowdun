import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse as parseToml } from "@iarna/toml";
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

const execFileAsync = promisify(execFile);

type LockPackage = {
  name: string;
  version: string;
  source?: string;
  checksum?: string;
  dependencies?: string[];
  features?: string[];
};

type Lockfile = {
  package?: LockPackage[];
};

type MetadataPackage = {
  id: string;
  name: string;
  version: string;
  license?: string | null;
  license_file?: string | null;
  source?: string | null;
  manifest_path?: string;
  description?: string | null;
  repository?: string | null;
};

type MetadataResolveNode = {
  id: string;
  deps?: Array<{
    pkg: string;
    dep_kinds?: Array<{
      kind?: string | null;
    }>;
  }>;
};

type Metadata = {
  packages: MetadataPackage[];
  resolve?: {
    nodes?: MetadataResolveNode[];
  };
  workspace_members: string[];
};

type GenerateCargoInventoryOptions = {
  lockfilePath: string;
  schemaPath: string;
  projectRoot: string;
  overrides: Overrides;
  warn: (message: string) => void;
  metadataPath?: string;
  manifestPath?: string;
};

function parseLockfile(contents: string): Lockfile {
  const parsed = parseToml(contents);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Unable to parse Cargo.lock");
  }
  return parsed as Lockfile;
}

function toPackageId(pkg: LockPackage): string | undefined {
  if (!pkg.source) {
    return undefined;
  }
  return `${pkg.source}#${pkg.name}@${pkg.version}`;
}

function resolveDependencyType(
  pkgId: string | undefined,
  directDeps: Set<string>
): DependencyType {
  if (pkgId && directDeps.has(pkgId)) {
    return "direct";
  }
  return "indirect";
}

function buildSource(
  pkg: LockPackage,
  metadata: MetadataPackage | undefined,
  projectRoot: string
): InventorySource {
  const source = pkg.source ?? metadata?.source ?? null;
  if (!source) {
    const manifest = metadata?.manifest_path;
    if (manifest) {
      return {
        type: "path",
        location: relative(projectRoot, manifest)
      };
    }
    return { type: "manual", location: pkg.name };
  }

  if (source.startsWith("registry+")) {
    return {
      type: "registry",
      location: source,
      registry: source.replace(/^registry\+/, "")
    };
  }

  if (source.startsWith("git+")) {
    return {
      type: "git",
      location: source
    };
  }

  if (source.startsWith("path+")) {
    const manifest = metadata?.manifest_path;
    return {
      type: "path",
      location: manifest ? relative(projectRoot, manifest) : source.replace(/^path\+/, "")
    };
  }

  return {
    type: "manual",
    location: source
  };
}

function extractFeatures(pkg: LockPackage): string[] | undefined {
  if (!pkg.features || pkg.features.length === 0) {
    return undefined;
  }
  return dedupeStrings(pkg.features);
}

function collectDirectDependencies(metadata: Metadata): Set<string> {
  const direct = new Set<string>();
  const resolveNodes = metadata.resolve?.nodes ?? [];
  const nodeMap = new Map<string, MetadataResolveNode>();
  for (const node of resolveNodes) {
    nodeMap.set(node.id, node);
  }

  for (const memberId of metadata.workspace_members) {
    const node = nodeMap.get(memberId);
    if (!node) continue;
    for (const dep of node.deps ?? []) {
      const kinds = dep.dep_kinds ?? [];
      const isDirect =
        kinds.length === 0 ||
        kinds.some((kind) => kind.kind === null || kind.kind === "normal" || kind.kind === "build");
      if (isDirect) {
        direct.add(dep.pkg);
      }
    }
  }

  return direct;
}

function buildMetadataMaps(metadata: Metadata) {
  const byId = new Map<string, MetadataPackage>();
  const byNameVersion = new Map<string, MetadataPackage>();
  for (const pkg of metadata.packages) {
    byId.set(pkg.id, pkg);
    const key = `${pkg.name}@${pkg.version}`;
    if (!byNameVersion.has(key)) {
      byNameVersion.set(key, pkg);
    }
  }
  return { byId, byNameVersion };
}

function findMetadataPackage(
  lockPkg: LockPackage,
  maps: ReturnType<typeof buildMetadataMaps>
): MetadataPackage | undefined {
  const id = toPackageId(lockPkg);
  if (id && maps.byId.has(id)) {
    return maps.byId.get(id);
  }
  const key = `${lockPkg.name}@${lockPkg.version}`;
  return maps.byNameVersion.get(key);
}

function isWorkspaceMember(
  metadataPkg: MetadataPackage | undefined,
  metadata: Metadata
): boolean {
  if (!metadataPkg) return false;
  return metadata.workspace_members.includes(metadataPkg.id);
}

function normaliseChecksum(value: string | undefined): string {
  return value && value.trim().length > 0 ? value : "UNKNOWN";
}

function determineResolved(pkg: LockPackage, metadataPkg: MetadataPackage | undefined): string {
  const source = pkg.source ?? metadataPkg?.source ?? undefined;
  if (!source) {
    return "UNKNOWN";
  }
  if (source.startsWith("registry+")) {
    const registry = source.replace(/^registry\+/, "");
    return `${registry}#${pkg.name}@${pkg.version}`;
  }
  if (source.startsWith("git+")) {
    return source;
  }
  if (source.startsWith("path+")) {
    return source;
  }
  return source;
}

export async function generateCargoInventory({
  lockfilePath,
  schemaPath,
  projectRoot,
  overrides,
  warn,
  metadataPath,
  manifestPath
}: GenerateCargoInventoryOptions): Promise<Inventory> {
  const lockfileRaw = await readFile(lockfilePath, "utf8");
  const lockfile = parseLockfile(lockfileRaw);
  const packages = lockfile.package ?? [];

  const metadataRaw = metadataPath
    ? await readFile(metadataPath, "utf8")
    : (
        await execFileAsync(
          "cargo",
          [
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--manifest-path",
            manifestPath ?? lockfilePath.replace(/Cargo\\.lock$/, "Cargo.toml")
          ],
          { encoding: "utf8" }
        )
      ).stdout;
  const metadata: Metadata = JSON.parse(metadataRaw);

  const directDeps = collectDirectDependencies(metadata);
  const metadataMaps = buildMetadataMaps(metadata);

  const inventoryMap = new Map<string, InventoryDependency>();

  for (const pkg of packages) {
    const metadataPkg = findMetadataPackage(pkg, metadataMaps);
    if (isWorkspaceMember(metadataPkg, metadata)) {
      continue;
    }

    const name = pkg.name;
    const version = pkg.version;
    const key = `${name}@${version}`;

    const pkgId = metadataPkg?.id ?? toPackageId(pkg);
    const dependencyType = resolveDependencyType(pkgId, directDeps);

    const override = overrides.get(name, version, "cargo");
    const licenseSource = metadataPkg?.license ?? undefined;
    const { licenses, missing, unparsable } = normaliseLicenses(licenseSource, override);
    if (missing) {
      warn(`License metadata missing for ${key}`);
    }
    for (const fragment of unparsable) {
      warn(`Unable to parse license expression for ${key}: ${fragment}`);
    }

    const checksum = normaliseChecksum(pkg.checksum);
    const resolved = determineResolved(pkg, metadataPkg);
    const source = buildSource(pkg, metadataPkg, projectRoot);
    const features = extractFeatures(pkg);

    const notes: string[] = [];
    if (override?.notes) {
      notes.push(override.notes);
    }
    if (missing && !override?.licenses) {
      notes.push("license metadata unavailable in cargo metadata");
    }
    if (metadataPkg?.license_file && !override?.licenses) {
      notes.push(`See license file at ${metadataPkg.license_file}`);
    }

    const provenanceEntry: InventoryDependency["provenance"][number] = {
      ecosystem: "cargo",
      dependencyType,
      resolved,
      checksum,
      source
    };
    if (features) {
      provenanceEntry.features = features;
    }

    const entry: InventoryDependency = {
      name,
      version,
      dependencyType,
      licenses,
      resolved,
      checksum,
      source,
      provenance: [provenanceEntry]
    };

    if (features) {
      entry.features = features;
    }

    if (notes.length > 0) {
      entry.notes = notes.join("; ");
    }

    if (inventoryMap.has(key)) {
      const existing = inventoryMap.get(key)!;
      existing.licenses = dedupeStrings([...existing.licenses, ...entry.licenses]);
      if (entry.dependencyType === "direct") {
        existing.dependencyType = "direct";
      }
      const mergedFeatures = dedupeStrings([
        ...(existing.features ?? []),
        ...(entry.features ?? [])
      ]);
      existing.features = mergedFeatures.length > 0 ? mergedFeatures : undefined;
      existing.provenance.push(...entry.provenance);
      if (entry.notes) {
        const existingNotes = existing.notes ? existing.notes.split("; ").filter(Boolean) : [];
        existing.notes = Array.from(new Set([...existingNotes, entry.notes])).join("; ");
      }
      continue;
    }

    inventoryMap.set(key, entry);
  }

  const dependencies = sortDependencies(Array.from(inventoryMap.values()));

  const inventory: Inventory = {
    generatedAt: new Date().toISOString(),
    source: {
      type: "cargo",
      lockfile: relative(projectRoot, lockfilePath),
      metadata: metadataPath
        ? relative(projectRoot, metadataPath)
        : relative(projectRoot, manifestPath ?? lockfilePath.replace(/Cargo\\.lock$/, "Cargo.toml"))
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

async function main() {
  const { values } = parseArgs({
    options: {
      lockfile: { type: "string", short: "l" },
      output: { type: "string", short: "o" },
      schema: { type: "string", short: "s" },
      overrides: { type: "string" },
      metadata: { type: "string" },
      manifest: { type: "string" }
    }
  });

  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const lockfilePath = values.lockfile
    ? resolve(values.lockfile)
    : join(projectRoot, "src-tauri", "Cargo.lock");
  const schemaPath = values.schema
    ? resolve(values.schema)
    : join(projectRoot, "schema", "licensing-inventory.schema.json");
  const outputPath = values.output
    ? resolve(values.output)
    : join(projectRoot, "artifacts", "licensing", "cargo-inventory.json");
  const metadataPath = values.metadata ? resolve(values.metadata) : undefined;
  const manifestPath = values.manifest ? resolve(values.manifest) : undefined;

  const defaultOverridesPath = join(projectRoot, "scripts", "licensing", "overrides.yaml");
  const overridesPath = values.overrides
    ? resolve(values.overrides)
    : (await fileExists(defaultOverridesPath))
        ? defaultOverridesPath
        : undefined;
  const overrides = await loadOverrides(overridesPath);

  const warnings: string[] = [];
  const inventory = await generateCargoInventory({
    lockfilePath,
    schemaPath,
    projectRoot,
    overrides,
    warn: (message) => {
      warnings.push(message);
      console.warn(message);
    },
    metadataPath,
    manifestPath
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(inventory, null, 2) + "\n");

  console.log(
    `Wrote ${relative(projectRoot, outputPath)} with ${inventory.dependencies.length} entries.`
  );

  if (warnings.length > 0) {
    process.exitCode = 2;
    console.warn(
      `${warnings.length} licensing warnings emitted. Review overrides or resolve upstream metadata.`
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
