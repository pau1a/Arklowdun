import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { generateInventory as generateNpmInventory } from "./npm-inventory.ts";
import { generateCargoInventory } from "./cargo-inventory.ts";
import { loadOverrides } from "./lib/overrides.ts";
import { mergeInventories } from "./lib/merge.ts";
import { Inventory } from "./lib/utils.ts";
import { readFile } from "node:fs/promises";

async function main() {
  const { values } = parseArgs({
    options: {
      schema: { type: "string", short: "s" },
      overrides: { type: "string" },
      "npm-lockfile": { type: "string" },
      "cargo-lockfile": { type: "string" },
      "cargo-manifest": { type: "string" },
      "cargo-metadata": { type: "string" },
      output: { type: "string", short: "o" }
    }
  });

  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const schemaPath = values.schema
    ? resolve(values.schema)
    : join(projectRoot, "schema", "licensing-inventory.schema.json");
  const outputDir = values.output
    ? resolve(values.output)
    : join(projectRoot, "artifacts", "licensing");

  const npmLockfile = values["npm-lockfile"]
    ? resolve(values["npm-lockfile"])
    : join(projectRoot, "package-lock.json");
  const cargoLockfile = values["cargo-lockfile"]
    ? resolve(values["cargo-lockfile"])
    : join(projectRoot, "src-tauri", "Cargo.lock");
  const cargoManifest = values["cargo-manifest"]
    ? resolve(values["cargo-manifest"])
    : join(projectRoot, "src-tauri", "Cargo.toml");
  const cargoMetadata = values["cargo-metadata"]
    ? resolve(values["cargo-metadata"])
    : undefined;

  const defaultOverridesPath = join(projectRoot, "scripts", "licensing", "overrides.yaml");
  const overridesPath = await resolveOverridesPath(values.overrides, defaultOverridesPath);
  const overrides = await loadOverrides(overridesPath);

  const warnings: string[] = [];

  const npmInventory = await generateNpmInventory({
    lockfilePath: npmLockfile,
    schemaPath,
    projectRoot,
    overrides,
    warn: (message) => {
      warnings.push(message);
      console.warn(message);
    }
  });

  const cargoInventory = await generateCargoInventory({
    lockfilePath: cargoLockfile,
    schemaPath,
    projectRoot,
    overrides,
    warn: (message) => {
      warnings.push(message);
      console.warn(message);
    },
    manifestPath: cargoManifest,
    metadataPath: cargoMetadata
  });

  const combined = mergeInventories([npmInventory, cargoInventory], overrides);

  await mkdir(outputDir, { recursive: true });

  await writeInventory(join(outputDir, "npm-inventory.json"), npmInventory, projectRoot);
  await writeInventory(join(outputDir, "cargo-inventory.json"), cargoInventory, projectRoot);
  await validateInventory(combined, schemaPath);

  await writeInventory(join(outputDir, "full-inventory.json"), combined, projectRoot);

  overrides.assertAllUsed(["npm", "cargo", "aggregate"]);

  if (warnings.length > 0) {
    process.exitCode = 2;
    console.warn(
      `${warnings.length} licensing warnings emitted. Review overrides or resolve upstream metadata.`
    );
  }
}

async function writeInventory(path: string, inventory: Inventory, projectRoot: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(inventory, null, 2) + "\n");
  console.log(
    `Wrote ${relative(projectRoot, path)} with ${inventory.dependencies.length} entries.`
  );
}

async function validateInventory(inventory: Inventory, schemaPath: string) {
  const schemaRaw = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(inventory)) {
    const errors = validate.errors ?? [];
    const details = errors.map((error) => `${error.instancePath} ${error.message}`).join("; ");
    throw new Error(`Combined inventory does not satisfy schema: ${details}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

async function resolveOverridesPath(
  provided: string | undefined,
  defaultPath: string
): Promise<string | undefined> {
  if (provided) {
    return resolve(provided);
  }
  try {
    await access(defaultPath, fsConstants.F_OK);
    return defaultPath;
  } catch {
    return undefined;
  }
}
