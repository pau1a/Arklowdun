import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = path.join(repoRoot, "src");

const warnings = [];
const counts = new Map();

function trackWarning(rule, file, message) {
  warnings.push({ rule, file, message });
  counts.set(rule, (counts.get(rule) ?? 0) + 1);
}

function isScriptFile(file) {
  const ext = path.extname(file);
  if (ext === ".d.ts") return false;
  return [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(ext);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.isFile() && isScriptFile(entry.name)) {
      await lintFile(fullPath);
    }
  }
}

function lintDeepRelative(content, relativePath) {
  const staticImport = /from ['"](\.\.\/\.\.(?:\/.+?)?)['"]/g;
  const dynamicImport = /import\((['"])(\.\.\/\.\.(?:\/.+?)?)\1\)/g;

  let match;
  while ((match = staticImport.exec(content))) {
    trackWarning(
      "no-deep-relative-imports",
      relativePath,
      `Prefer an alias import instead of "${match[1]}"`,
    );
  }
  while ((match = dynamicImport.exec(content))) {
    trackWarning(
      "no-deep-relative-imports",
      relativePath,
      `Prefer an alias import instead of "${match[2]}"`,
    );
  }
}

function isComponentsPath(relativePath) {
  const segments = relativePath.split(path.sep);
  return segments.includes("components");
}

function lintComponentsIpc(content, relativePath) {
  if (!isComponentsPath(relativePath)) return;

  const staticImport = /from ['"]([^'"]+)['"]/g;
  const dynamicImport = /import\((['"])([^'"]+)\1\)/g;

  const checkSource = (source) => {
    if (source.startsWith("@tauri-apps/api")) return true;
    if (source.startsWith("@tauri-apps/plugin-")) return true;
    if (source.startsWith("@lib/ipc")) return true;
    if (/\blib\/ipc\b/.test(source) && (source.startsWith("./") || source.startsWith("../"))) {
      return true;
    }
    return false;
  };

  let match;
  while ((match = staticImport.exec(content))) {
    if (checkSource(match[1])) {
      trackWarning(
        "no-ipc-in-components",
        relativePath,
        `Avoid importing IPC module "${match[1]}" directly inside components`,
      );
    }
  }

  while ((match = dynamicImport.exec(content))) {
    if (checkSource(match[2])) {
      trackWarning(
        "no-ipc-in-components",
        relativePath,
        `Avoid dynamically importing IPC module "${match[2]}" inside components`,
      );
    }
  }
}

function lintFilesBannedTags(content, relativePath) {
  if (!relativePath.startsWith(path.join('src', 'features', 'files'))) return;
  const banned = /<\s*(button|input|select)\b/i;
  if (banned.test(content)) {
    trackWarning(
      'no-raw-controls',
      relativePath,
      'Avoid raw <button>/<input>/<select> in Files feature; use @ui primitives.',
    );
  }
}

async function lintFile(fullPath) {
  const content = await readFile(fullPath, "utf8");
  const relativePath = path.relative(repoRoot, fullPath);
  lintDeepRelative(content, relativePath);
  lintComponentsIpc(content, relativePath);
  lintFilesBannedTags(content, relativePath);
}

async function main() {
  try {
    await walk(srcRoot);
  } catch (error) {
    console.error("[structure-lint] Failed to run:", error);
    process.exitCode = 0;
    return;
  }

  if (warnings.length === 0) {
    console.log("[structure-lint] No warnings detected.");
    return;
  }

  for (const warning of warnings) {
    console.warn(
      `[structure-lint] Warning (${warning.rule}) in ${warning.file}: ${warning.message}`,
    );
  }

  console.warn(`\n[structure-lint] ${warnings.length} warning(s) total.`);
  for (const [rule, count] of counts.entries()) {
    console.warn(`[structure-lint]   ${rule}: ${count}`);
  }
}

await main();
