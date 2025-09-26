import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { dedupeStrings, Ecosystem } from "./utils.ts";

export type OverrideScope = Exclude<Ecosystem, "aggregate"> | "aggregate";

export type OverrideEntry = {
  licenses?: string[];
  notes?: string;
  ecosystems?: OverrideScope[];
};

type InternalOverride = {
  value: OverrideEntry;
  used: boolean;
};

export class Overrides {
  private readonly overrides = new Map<string, InternalOverride>();

  constructor(initial?: Record<string, OverrideEntry>) {
    if (!initial) {
      return;
    }

    for (const [key, value] of Object.entries(initial)) {
      if (!value || typeof value !== "object") {
        throw new Error(`Override for ${key} must be an object`);
      }
      if (value.licenses) {
        value.licenses = dedupeStrings(value.licenses);
      }
      this.overrides.set(key, { value, used: false });
    }
  }

  get(name: string, version: string, scope: OverrideScope): OverrideEntry | undefined {
    const exactKey = `${name}@${version}`;
    const entry = this.overrides.get(exactKey) ?? this.overrides.get(name);
    if (!entry) {
      return undefined;
    }

    const ecosystems = entry.value.ecosystems;
    if (ecosystems && ecosystems.length > 0 && !ecosystems.includes(scope)) {
      return undefined;
    }

    entry.used = true;
    return entry.value;
  }

  assertAllUsed(scopes: OverrideScope[]): void {
    const activeScopes = new Set(scopes);
    for (const [key, entry] of this.overrides) {
      const { ecosystems } = entry.value;
      const relevant = !ecosystems || ecosystems.some((scope) => activeScopes.has(scope));
      if (relevant && !entry.used) {
        throw new Error(`Override ${key} was not applied. Update overrides or remove the entry.`);
      }
    }
  }
}

export async function loadOverrides(path: string | undefined): Promise<Overrides> {
  if (!path) {
    return new Overrides();
  }

  try {
    await access(path, fsConstants.F_OK);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`Overrides file not found: ${path}`);
    }
    throw error;
  }

  const raw = await readFile(path, "utf8");
  let parsed: any;
  const extension = extname(path).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    parsed = parseYaml(raw);
  } else {
    parsed = JSON.parse(raw);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Overrides file must contain an object map");
  }

  return new Overrides(parsed as Record<string, OverrideEntry>);
}
