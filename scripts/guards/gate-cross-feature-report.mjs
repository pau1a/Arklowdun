import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const featuresRoot = path.join(repoRoot, "src", "features");

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const findings = [];

function isCodeFile(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".d.ts") return false;
  return CODE_EXTENSIONS.has(ext);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function detectCrossFeatureImports(content, currentFeature) {
  const results = [];
  const staticImport = /(?:import|export)[^'"`]*?from\s+(['"])([^'"`]+)\1/g;
  const bareImport = /import\s+(['"])([^'"`]+)\1/g;
  const dynamicImport = /import\((['"])([^'"`]+)\1\)/g;
  const requireCall = /require\((['"])([^'"`]+)\1\)/g;

  const examine = (specifier) => {
    if (!specifier.startsWith("@features/")) return;
    const remainder = specifier.slice("@features/".length);
    const segments = remainder.split("/");
    if (segments.length < 2) return;
    const [targetFeature, firstSegment] = segments;
    if (!targetFeature || targetFeature === currentFeature) return;
    if (["components", "api", "model", "hooks"].includes(firstSegment)) {
      results.push({ specifier, targetFeature });
    }
  };

  let match;
  while ((match = staticImport.exec(content))) {
    examine(match[2]);
  }
  while ((match = bareImport.exec(content))) {
    examine(match[2]);
  }
  while ((match = dynamicImport.exec(content))) {
    examine(match[2]);
  }
  while ((match = requireCall.exec(content))) {
    examine(match[2]);
  }

  return results;
}

async function walkFeatures(dir, currentFeature) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFeatures(fullPath, currentFeature);
    } else if (entry.isFile() && isCodeFile(entry.name)) {
      const content = await readFile(fullPath, "utf8");
      const crossImports = detectCrossFeatureImports(content, currentFeature);
      if (crossImports.length === 0) continue;
      findings.push({
        file: toPosix(path.relative(repoRoot, fullPath)),
        imports: crossImports.map((item) => item.specifier),
        currentFeature,
      });
    }
  }
}

async function walkFeatureRoot() {
  const entries = await readdir(featuresRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const featureDir = path.join(featuresRoot, entry.name);
    await walkFeatures(featureDir, entry.name);
  }
}

async function main() {
  try {
    await walkFeatureRoot();
  } catch (error) {
    console.error("gate/cross-feature-report: failed to scan", error);
    process.exitCode = 1;
    return;
  }

  if (findings.length === 0) {
    console.log("gate/cross-feature-report: no cross-feature internal imports detected.");
    return;
  }

  let total = 0;
  for (const finding of findings) {
    total += finding.imports.length;
    for (const specifier of finding.imports) {
      console.log(
        `::warning file=${finding.file},title=gate/cross-feature-report::Imports ${specifier} from another feature's internals`,
      );
    }
  }

  console.log(
    `gate/cross-feature-report: found ${total} cross-feature internal import(s) across ${findings.length} file(s).`,
  );
  for (const finding of findings) {
    console.log(`  - ${finding.file} → ${finding.imports.join(", ")}`);
  }
}

await main();
