import { Overrides } from "./overrides.ts";
import {
  Inventory,
  InventoryDependency,
  InventorySource,
  InventorySourceDescriptor,
  dedupeStrings,
  sortDependencies
} from "./utils.ts";

function cloneSource(source: InventorySource): InventorySource {
  return { ...source };
}

function cloneDependency(dependency: InventoryDependency): InventoryDependency {
  return {
    name: dependency.name,
    version: dependency.version,
    dependencyType: dependency.dependencyType,
    licenses: [...dependency.licenses],
    resolved: dependency.resolved,
    checksum: dependency.checksum,
    source: cloneSource(dependency.source),
    provenance: dependency.provenance.map((entry) => ({
      ...entry,
      source: cloneSource(entry.source),
      features: entry.features ? [...entry.features] : undefined
    })),
    features: dependency.features ? [...dependency.features] : undefined,
    notes: dependency.notes
  };
}

function mergeNotes(existing: string | undefined, addition: string | undefined): string | undefined {
  const notes = [existing, addition].filter((value): value is string => Boolean(value && value.trim()));
  if (notes.length === 0) {
    return existing;
  }
  const fragments = notes
    .flatMap((note) => note.split(";"))
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(fragments));
  return unique.join("; ");
}

function mergeSources(
  inventories: InventorySourceDescriptor[]
): Array<{ type: "npm" | "cargo"; path: string }> {
  const seen = new Set<string>();
  const inputs: Array<{ type: "npm" | "cargo"; path: string }> = [];

  for (const source of inventories) {
    if (source.type === "npm") {
      const key = `npm:${source.lockfile}`;
      if (!seen.has(key)) {
        seen.add(key);
        inputs.push({ type: "npm", path: source.lockfile });
      }
    } else if (source.type === "cargo") {
      const key = `cargo:${source.lockfile}`;
      if (!seen.has(key)) {
        seen.add(key);
        inputs.push({ type: "cargo", path: source.lockfile });
      }
    }
  }

  return inputs;
}

type AggregatedEntry = {
  entry: InventoryDependency;
  ecosystems: Set<string>;
  conflict?: {
    existing: string[];
    incoming: string[];
  };
};

export function mergeInventories(
  inventories: Inventory[],
  overrides: Overrides
): Inventory {
  const aggregated = new Map<string, AggregatedEntry>();

  for (const inventory of inventories) {
    for (const dependency of inventory.dependencies) {
      const key = `${dependency.name}@${dependency.version}`;
      const cloned = cloneDependency(dependency);
      const provenanceEcosystems = new Set(
        cloned.provenance.map((entry) => entry.ecosystem)
      );

      if (!aggregated.has(key)) {
        aggregated.set(key, {
          entry: cloned,
          ecosystems: provenanceEcosystems
        });
        continue;
      }

      const wrapper = aggregated.get(key)!;
      const existing = wrapper.entry;
      const beforeLicenses = new Set(existing.licenses);
      const incomingLicenses = new Set(cloned.licenses);

      existing.licenses = dedupeStrings([...existing.licenses, ...cloned.licenses]);
      if (cloned.dependencyType === "direct") {
        existing.dependencyType = "direct";
      }

      const mergedFeatures = dedupeStrings([
        ...(existing.features ?? []),
        ...(cloned.features ?? [])
      ]);
      existing.features = mergedFeatures.length > 0 ? mergedFeatures : undefined;

      const newProvenance = cloned.provenance.map((entry) => ({
        ...entry,
        source: cloneSource(entry.source)
      }));
      existing.provenance.push(...newProvenance);

      existing.notes = mergeNotes(existing.notes, cloned.notes);

      for (const ecosystem of provenanceEcosystems) {
        wrapper.ecosystems.add(ecosystem);
      }

      if (wrapper.ecosystems.size > 1) {
        existing.resolved = "UNKNOWN";
        existing.checksum = "UNKNOWN";
        existing.source = { type: "aggregate", location: "multiple" };
      }

      const differenceA = Array.from(beforeLicenses).filter(
        (license) => !incomingLicenses.has(license)
      );
      const differenceB = Array.from(incomingLicenses).filter(
        (license) => !beforeLicenses.has(license)
      );
      if ((differenceA.length > 0 || differenceB.length > 0) && wrapper.ecosystems.size > 1) {
        wrapper.conflict = {
          existing: Array.from(beforeLicenses),
          incoming: Array.from(incomingLicenses)
        };
      }
    }
  }

  const dependencies: InventoryDependency[] = [];

  for (const { entry, conflict } of aggregated.values()) {
    const override = overrides.get(entry.name, entry.version, "aggregate");
    if (conflict && !(override?.licenses && override.licenses.length > 0)) {
      throw new Error(
        `License conflict for ${entry.name}@${entry.version}: ${conflict.existing.join(", ")} vs ${
          conflict.incoming
        }. Provide an override to resolve.`
      );
    }

    if (override?.licenses) {
      entry.licenses = dedupeStrings(override.licenses);
    }
    if (override?.notes) {
      entry.notes = mergeNotes(entry.notes, override.notes);
    }

    dependencies.push(entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: {
      type: "aggregate",
      inputs: mergeSources(inventories.map((inventory) => inventory.source))
    },
    dependencies: sortDependencies(dependencies)
  };
}
