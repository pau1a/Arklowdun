import spdxParse from "spdx-expression-parse";
import { dedupeStrings } from "./utils.ts";

export type NormalisedLicenseResult = {
  licenses: string[];
  missing: boolean;
  unparsable: string[];
};

export function normaliseLicenses(
  raw: string | string[] | { type?: string } | Array<string | { type?: string }> | undefined,
  override?: { licenses?: string[] }
): NormalisedLicenseResult {
  if (override?.licenses && override.licenses.length > 0) {
    return {
      licenses: dedupeStrings(override.licenses),
      missing: false,
      unparsable: []
    };
  }

  if (!raw) {
    return { licenses: ["UNKNOWN"], missing: true, unparsable: [] };
  }

  const candidates = Array.isArray(raw) ? raw : [raw];
  const licenses: string[] = [];
  const unparsable: string[] = [];

  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : candidate?.type?.trim();
    if (!value) {
      continue;
    }

    try {
      const parsed = spdxParse(value);
      collectSpdx(parsed, licenses);
    } catch (error) {
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
