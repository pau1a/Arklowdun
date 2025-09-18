import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const srcRoot = path.join(repoRoot, "src");

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ALLOWLISTED_FILES = new Set([
  "src/features/calendar/api/calendarApi.ts",
  "src/features/calendar/components/CalendarGrid.ts",
  "src/features/notes/api/notesApi.ts",
  "src/features/settings/api/settingsApi.ts",
  "src/features/settings/model/Settings.ts",
]);

const violations = [];
const allowlistedFindings = [];

function isCodeFile(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".d.ts") return false;
  return CODE_EXTENSIONS.has(ext);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function collectDeepRelativeImports(content) {
  const sources = new Set();

  const staticImport = /(?:import|export)[^'"`]*?from\s+(['"])((?:\.\.\/){2,}[^'"`]+)\1/g;
  const bareImport = /import\s+(['"])((?:\.\.\/){2,}[^'"`]+)\1/g;
  const dynamicImport = /import\((['"])((?:\.\.\/){2,}[^'"`]+)\1\)/g;
  const requireCall = /require\((['"])((?:\.\.\/){2,}[^'"`]+)\1\)/g;

  let match;
  while ((match = staticImport.exec(content))) {
    sources.add(match[2]);
  }
  while ((match = bareImport.exec(content))) {
    sources.add(match[2]);
  }
  while ((match = dynamicImport.exec(content))) {
    sources.add(match[2]);
  }
  while ((match = requireCall.exec(content))) {
    sources.add(match[2]);
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
    } else if (entry.isFile() && isCodeFile(entry.name)) {
      const relativeRepoPath = path.relative(repoRoot, fullPath);
      if (!relativeRepoPath.startsWith("src")) continue;
      const content = await readFile(fullPath, "utf8");
      const imports = collectDeepRelativeImports(content);
      if (imports.length === 0) continue;
      const posixPath = toPosix(relativeRepoPath);
      if (ALLOWLISTED_FILES.has(posixPath)) {
        allowlistedFindings.push({ file: posixPath, imports });
        continue;
      }
      violations.push({ file: posixPath, imports });
    }
  }
}

async function main() {
  try {
    await walk(srcRoot);
  } catch (error) {
    console.error("gate/no-deep-relatives: failed to scan", error);
    process.exitCode = 1;
    return;
  }

  if (allowlistedFindings.length > 0) {
    for (const finding of allowlistedFindings) {
      const message = `Grandfathered deep relative import(s): ${finding.imports.join(", ")}`;
      console.log(
        `::notice file=${finding.file},title=gate/no-deep-relatives (allowlist)::${message}`,
      );
    }
  }

  if (violations.length === 0) {
    console.log("gate/no-deep-relatives: no deep parent-relative imports detected outside the allowlist.");
    return;
  }

  for (const violation of violations) {
    const message = `Disallowed deep relative import(s): ${violation.imports.join(", ")}`;
    console.log(
      `::error file=${violation.file},title=gate/no-deep-relatives::${message}`,
    );
  }
  console.error(
    `gate/no-deep-relatives: ${violations.length} file(s) contain ../../ (or deeper) imports inside src/**.`,
  );
  console.error("Refactor to path aliases such as @features/*, @ui/*, @layout/*, or @lib/*.");
  process.exitCode = 1;
}

await main();
