#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

const featuresRoot = path.join(repoRoot, "src/features");
const fileExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs"]);

async function collectComponentFiles() {
  const features = [];
  try {
    const entries = await readdir(featuresRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const componentDir = path.join(featuresRoot, entry.name, "components");
      try {
        features.push(...(await walk(componentDir)));
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return features;
}

async function walk(dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(fullPath)));
    } else if (fileExtensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

const banned = [
  /^@tauri-apps\//,
  /^@lib\/ipc$/,
  /^@lib\/filesystem$/,
  /ipc\/?$/,
];

function violates(specifier) {
  return banned.some((pattern) => pattern.test(specifier));
}

async function checkFile(file) {
  const content = await readFile(file, "utf8");
  const problems = [];
  const regex = /(?:import|export)\s+(?:[^'";]+?from\s+)?['"]([^'";]+)['"];?/g;
  for (const match of content.matchAll(regex)) {
    const specifier = match[1];
    if (violates(specifier)) {
      problems.push(specifier);
    }
  }
  return problems;
}

const violations = [];

for (const file of await collectComponentFiles()) {
  const problems = await checkFile(file);
  if (problems.length > 0) {
    violations.push({ file: path.relative(repoRoot, file), problems });
  }
}

if (violations.length > 0) {
  console.error("IPC access detected in component files:");
  for (const violation of violations) {
    console.error(` - ${violation.file}`);
    for (const specifier of violation.problems) {
      console.error(`    ↳ ${specifier}`);
    }
  }
  process.exit(1);
}

console.log("Component IPC guard passed.");
