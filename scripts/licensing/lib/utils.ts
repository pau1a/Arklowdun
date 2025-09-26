export type DependencyType = "direct" | "indirect";

export type Ecosystem = "npm" | "cargo" | "aggregate";

export type SourceType = "npm" | "git" | "manual" | "registry" | "path" | "aggregate";

export type InventorySource = {
  type: SourceType;
  location: string;
  registry?: string;
};

export type ProvenanceEntry = {
  ecosystem: Exclude<Ecosystem, "aggregate">;
  dependencyType: DependencyType;
  resolved: string;
  checksum: string;
  source: InventorySource;
  features?: string[];
  notes?: string;
};

export type InventoryDependency = {
  name: string;
  version: string;
  dependencyType: DependencyType;
  licenses: string[];
  resolved: string;
  checksum: string;
  source: InventorySource;
  provenance: ProvenanceEntry[];
  features?: string[];
  notes?: string;
};

export type InventorySourceDescriptor =
  | {
      type: "npm";
      lockfile: string;
    }
  | {
      type: "cargo";
      lockfile: string;
      metadata: string;
    }
  | {
      type: "aggregate";
      inputs: Array<{
        type: "npm" | "cargo";
        path: string;
      }>;
    };

export type Inventory = {
  generatedAt: string;
  source: InventorySourceDescriptor;
  dependencies: InventoryDependency[];
};

export function dedupeStrings(values: string[]): string[] {
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

export function sortDependencies<T extends { name: string; version: string }>(
  values: T[]
): T[] {
  return values.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
