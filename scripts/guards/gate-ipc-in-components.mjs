import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = path.join(repoRoot, "src");

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const FORBIDDEN_PREFIXES = ["@tauri-apps/api", "@tauri-apps/plugin-"];

const violations = [];

function isCodeFile(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".d.ts") return false;
  return CODE_EXTENSIONS.has(ext);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function shouldInspect(relativeFromSrc) {
  const normalized = toPosix(relativeFromSrc);
  if (!isCodeFile(relativeFromSrc)) return false;
  if (normalized === "main.ts") return true;
  if (normalized.startsWith("ui/")) return true;
  return normalized.split("/").includes("components");
}

function extractForbiddenSources(content) {
  const staticImport = /(?:import|export)[^'"`]*?from\s+(['"])([^'"`]+)\1/g;
  const bareImport = /import\s+(['"])([^'"`]+)\1/g;
  const dynamicImport = /import\((['"])([^'"`]+)\1\)/g;
  const requireCall = /require\((['"])([^'"`]+)\1\)/g;

  const sources = new Set();

  const check = (specifier) => {
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (specifier.startsWith(prefix)) {
        sources.add(specifier);
        break;
      }
    }
  };

  let match;
  while ((match = staticImport.exec(content))) {
    check(match[2]);
  }
  while ((match = bareImport.exec(content))) {
    check(match[2]);
  }
  while ((match = dynamicImport.exec(content))) {
    check(match[2]);
  }
  while ((match = requireCall.exec(content))) {
    check(match[2]);
  }

  return [...sources];
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile()) {
      const relativeFromSrc = path.relative(srcRoot, fullPath);
      if (!shouldInspect(relativeFromSrc)) continue;
      const content = await readFile(fullPath, "utf8");
      const forbiddenSources = extractForbiddenSources(content);
      if (forbiddenSources.length > 0) {
        violations.push({
          file: toPosix(path.relative(repoRoot, fullPath)),
          sources: forbiddenSources,
        });
      }
    }
  }
}

async function main() {
  try {
    await walk(srcRoot);
  } catch (error) {
    console.error("gate/ipc-in-components: failed to scan", error);
    process.exitCode = 1;
    return;
  }

  if (violations.length === 0) {
    console.log("gate/ipc-in-components: no forbidden IPC imports detected.");
    return;
  }

  for (const violation of violations) {
    const message = `Forbidden IPC import(s): ${violation.sources.join(", ")}`;
    console.log(
      `::error file=${violation.file},title=gate/ipc-in-components::${message}`,
    );
  }
  console.error(
    `gate/ipc-in-components: ${violations.length} file(s) import Tauri IPC modules directly.`,
  );
  console.error(
    "Forbidden locations: src/ui/**, src/**/components/**, and src/main.ts. Allowed surfaces live under src/lib/ipc/** or feature API layers.",
  );
  process.exitCode = 1;
}

await main();
