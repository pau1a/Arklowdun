#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

const targetDirs = [
  path.join(repoRoot, "src/features"),
  path.join(repoRoot, "src/layout"),
  path.join(repoRoot, "src/ui"),
  path.join(repoRoot, "src/store"),
];

const fileExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

async function collectFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (fileExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasDeepRelative(specifier) {
  return specifier.includes("../..") || specifier.includes("..\\..");
}

async function checkFile(file) {
  const content = await readFile(file, "utf8");
  const issues = [];
  const regex = /(?:import|export)\s+(?:[^'";]+?from\s+)?['"]([^'";]+)['"];?/g;
  for (const match of content.matchAll(regex)) {
    const specifier = match[1];
    if (hasDeepRelative(specifier)) {
      issues.push(specifier);
    }
  }
  return issues;
}

const violations = [];

for (const dir of targetDirs) {
  let files = [];
  try {
    files = await collectFiles(dir);
  } catch (error) {
    if (error && error.code === "ENOENT") continue;
    throw error;
  }
  for (const file of files) {
    const issues = await checkFile(file);
    if (issues.length > 0) {
      violations.push({ file: path.relative(repoRoot, file), issues });
    }
  }
}

if (violations.length > 0) {
  console.error("Found deep relative imports (use aliases instead):");
  for (const violation of violations) {
    console.error(` - ${violation.file}`);
    for (const specifier of violation.issues) {
      console.error(`    ↳ ${specifier}`);
    }
  }
  process.exit(1);
}

console.log("Import alias check passed.");
